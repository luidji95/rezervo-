import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabaseServer";
import { createAppointment } from "@/services/appointmentService";
import { AppointmentSlotUnavailableError } from "@/services/appointmentValidationService";

const publicCreateBookingSchema = z.object({
  salonSlug: z.string().trim().min(1),
  serviceId: z.string().uuid(),
  employeeId: z.string().uuid(),
  startTime: z.string().datetime(),
  customer: z
    .object({
      fullName: z.string().trim().min(2),
      phone: z.string().trim().optional(),
      email: z.union([z.string().trim().email(), z.literal("")]).optional(),
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

    const { salonSlug, serviceId, employeeId, startTime, customer } =
      parsed.data;

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

    const appointment = await createAppointment(
      {
        salonId: salon.id,
        serviceId,
        employeeId,
        startTime,
        client: {
          fullName: customer.fullName,
          phone: customer.phone,
          email: customer.email,
        },
        bookingSource: "public",
      },
      supabaseServer,
      {
        enforceGeneratedSlot: true,
      }
    );

    return NextResponse.json(
      {
        success: true,
        appointmentId: appointment.id,
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof AppointmentSlotUnavailableError) {
      return NextResponse.json(
        {
          error: "Selected time is no longer available.",
          code: "SLOT_UNAVAILABLE",
        },
        { status: 409 }
      );
    }

    console.error("PUBLIC_CREATE_BOOKING_ERROR", error);

    return NextResponse.json(
      { error: "Failed to create booking" },
      { status: 500 }
    );
  }
}
