import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { generateAvailableSlots } from "@/services/availabilityService";
import { supabaseServer } from "@/lib/supabaseServer";
import { hasPublicBookingAccess } from "@/features/public-booking/services/publicBookingAccessService";

const publicAvailabilitySchema = z.object({
  salonId: z.string().uuid(),
  employeeId: z.string().uuid(),
  serviceId: z.string().uuid(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((value) => {
      const parsed = new Date(`${value}T00:00:00Z`);

      return (
        !Number.isNaN(parsed.getTime()) &&
        parsed.toISOString().slice(0, 10) === value
      );
    }),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const parsed = publicAvailabilitySchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid availability request.",
        },
        {
          status: 400,
        }
      );
    }

    const { salonId, employeeId, serviceId, date } = parsed.data;

    const { data: salon, error: salonError } = await supabaseServer
      .from("salons")
      .select("id, status, booking_enabled, online_booking_enabled")
      .eq("id", salonId)
      .maybeSingle();

    if (salonError) {
      throw salonError;
    }

    if (!salon) {
      return NextResponse.json(
        { success: false, error: "Salon not found." },
        { status: 404 }
      );
    }

    if (
      salon.status !== "active" ||
      !salon.booking_enabled ||
      !salon.online_booking_enabled ||
      !(await hasPublicBookingAccess(salonId))
    ) {
      return NextResponse.json(
        { success: false, code: "BOOKING_UNAVAILABLE" },
        { status: 403 }
      );
    }

    const [{ data: service, error: serviceError }, employeeResult] =
      await Promise.all([
        supabaseServer
          .from("services")
          .select("id")
          .eq("id", serviceId)
          .eq("salon_id", salonId)
          .eq("is_active", true)
          .eq("is_public", true)
          .maybeSingle(),
        supabaseServer
          .from("employees")
          .select("id, employee_services!inner(id)")
          .eq("id", employeeId)
          .eq("salon_id", salonId)
          .eq("is_active", true)
          .eq("is_bookable", true)
          .eq("is_public", true)
          .eq("employee_services.salon_id", salonId)
          .eq("employee_services.service_id", serviceId)
          .eq("employee_services.is_active", true)
          .limit(1)
          .maybeSingle(),
      ]);

    if (serviceError) {
      throw serviceError;
    }

    if (!service) {
      return NextResponse.json(
        { success: false, error: "Selected service is not available." },
        { status: 404 }
      );
    }

    if (employeeResult.error) {
      throw employeeResult.error;
    }

    if (!employeeResult.data) {
      return NextResponse.json(
        { success: false, error: "Selected employee is not available." },
        { status: 404 }
      );
    }

    const result = await generateAvailableSlots(
      {
        salonId,
        employeeId,
        serviceId,
        date,
      },
      supabaseServer
    );

    return NextResponse.json({
      success: true,
      slots: result.slots,
    });
  } catch (error) {
    console.error("PUBLIC_AVAILABILITY_FAILED", { errorPresent: Boolean(error) });

    return NextResponse.json(
      {
        success: false,
        code: "BOOKING_UNAVAILABLE",
      },
      {
        status: 500,
      }
    );
  }
}
