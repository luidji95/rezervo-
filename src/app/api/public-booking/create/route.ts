import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabaseServer";
import { createPublicBookingAtomic } from "@/services/appointmentService";
import { generateAvailableSlots } from "@/services/availabilityService";
import {
  normalizeClientEmail,
  normalizeClientPhone,
} from "@/services/clientService";

const SALON_TIMEZONE = "Europe/Belgrade";

const publicCreateBookingSchema = z.object({
  salonSlug: z.string().trim().min(1),
  serviceId: z.string().uuid(),
  employeeId: z.string().uuid(),
  idempotencyKey: z.string().uuid(),
  startTime: z.string().datetime(),
  customer: z
    .object({
      fullName: z.string().trim().min(2),
      phone: z.string().trim().optional(),
      email: z.union([z.string().trim().email(), z.literal("")]).optional(),
      note: z.string().trim().max(1000).optional(),
    })
    .superRefine((customer, context) => {
      if (!customer.phone && !customer.email) {
        context.addIssue({
          code: "custom",
          path: ["phone"],
          message: "Phone or email is required.",
        });
      }
    }),
});

function getDateInTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    throw new Error("Failed to format booking date.");
  }

  return `${year}-${month}-${day}`;
}

function getPostgresErrorCode(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return null;
  }

  return typeof error.code === "string" ? error.code : null;
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const parsed = publicCreateBookingSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid booking data." },
        { status: 400 }
      );
    }

    const {
      salonSlug,
      serviceId,
      employeeId,
      startTime,
      customer,
      idempotencyKey,
    } = parsed.data;

    const { data: salon, error: salonError } = await supabaseServer
      .from("salons")
      .select("id, booking_enabled, online_booking_enabled, status")
      .eq("slug", salonSlug)
      .single();

    if (salonError || !salon) {
      return NextResponse.json(
        { error: "Salon not found" },
        { status: 404 }
      );
    }

    if (
      salon.status !== "active" ||
      !salon.booking_enabled ||
      !salon.online_booking_enabled
    ) {
      return NextResponse.json(
        { error: "Online booking is disabled for this salon" },
        { status: 403 }
      );
    }

    const [{ data: service, error: serviceError }, employeeResult] =
      await Promise.all([
        supabaseServer
          .from("services")
          .select("id")
          .eq("id", serviceId)
          .eq("salon_id", salon.id)
          .eq("is_active", true)
          .eq("is_public", true)
          .maybeSingle(),
        supabaseServer
          .from("employees")
          .select("id, employee_services!inner(id)")
          .eq("id", employeeId)
          .eq("salon_id", salon.id)
          .eq("is_active", true)
          .eq("is_bookable", true)
          .eq("is_public", true)
          .eq("employee_services.salon_id", salon.id)
          .eq("employee_services.service_id", serviceId)
          .eq("employee_services.is_active", true)
          .limit(1)
          .maybeSingle(),
      ]);

    if (serviceError || employeeResult.error) {
      throw serviceError || employeeResult.error;
    }

    if (!service || !employeeResult.data) {
      return NextResponse.json(
        { error: "Selected booking option is not available." },
        { status: 404 }
      );
    }

    const { data: existingAppointment, error: idempotencyLookupError } =
      await supabaseServer
        .from("appointments")
        .select(
          "id, salon_id, primary_service_id, employee_id, start_time"
        )
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();

    if (idempotencyLookupError) {
      throw idempotencyLookupError;
    }

    if (existingAppointment) {
      const matchesOriginalRequest =
        existingAppointment.salon_id === salon.id &&
        existingAppointment.primary_service_id === serviceId &&
        existingAppointment.employee_id === employeeId &&
        new Date(existingAppointment.start_time).getTime() ===
          new Date(startTime).getTime();

      if (!matchesOriginalRequest) {
        return NextResponse.json(
          { error: "Invalid idempotency key." },
          { status: 400 }
        );
      }

      return NextResponse.json({
        success: true,
        appointmentId: existingAppointment.id,
      });
    }

    const appointmentStart = new Date(startTime);
    const bookingDate = getDateInTimeZone(appointmentStart, SALON_TIMEZONE);
    const availability = await generateAvailableSlots(
      {
        salonId: salon.id,
        serviceId,
        employeeId,
        date: bookingDate,
      },
      supabaseServer
    );

    const isAvailable = availability.slots.some(
      (slot) =>
        slot.employeeId === employeeId &&
        new Date(slot.startTime).getTime() === appointmentStart.getTime()
    );

    if (!isAvailable) {
      return NextResponse.json(
        {
          error: "Selected time is no longer available.",
          code: "SLOT_UNAVAILABLE",
        },
        { status: 409 }
      );
    }

    const appointment = await createPublicBookingAtomic(
      {
        salonId: salon.id,
        salonSlug,
        serviceId,
        employeeId,
        startTime,
        customer: {
          fullName: customer.fullName.trim(),
          phone: normalizeClientPhone(customer.phone) ?? "",
          email: normalizeClientEmail(customer.email) ?? "",
        },
        idempotencyKey,
      },
      supabaseServer
    );

    if (appointment.wasCreated && customer.note?.trim()) {
      const { error: noteError } = await supabaseServer
        .from("appointments")
        .update({ customer_note: customer.note.trim() })
        .eq("id", appointment.id)
        .eq("salon_id", salon.id);

      if (noteError) {
        console.error("PUBLIC_BOOKING_NOTE_ERROR", {
          code: noteError.code,
          appointmentIdPresent: Boolean(appointment.id),
        });
      }
    }

    return NextResponse.json(
      {
        success: true,
        appointmentId: appointment.id,
      },
      { status: appointment.wasCreated ? 201 : 200 }
    );
  } catch (error) {
    if (getPostgresErrorCode(error) === "23P01") {
      return NextResponse.json(
        {
          error: "Selected time is no longer available.",
          code: "SLOT_UNAVAILABLE",
        },
        { status: 409 }
      );
    }

    if (getPostgresErrorCode(error) === "22023") {
      return NextResponse.json(
        { error: "Invalid booking data." },
        { status: 400 }
      );
    }

    console.error("PUBLIC_CREATE_BOOKING_ERROR", error);

    return NextResponse.json(
      { error: "Failed to create booking" },
      { status: 500 }
    );
  }
}
