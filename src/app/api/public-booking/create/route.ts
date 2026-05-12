import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabaseServer";
import { createAppointment } from "@/services/appointmentService";

const publicCreateBookingSchema = z.object({
  salonSlug: z.string().min(1),
  serviceId: z.string().uuid(),
  employeeId: z.string().uuid(),
  startTime: z.string().datetime(),
  customer: z.object({
    fullName: z.string().min(2),
    phone: z.string().optional(),
    email: z.string().email().optional(),
  }),
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = publicCreateBookingSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid booking data", issues: parsed.error.flatten() },
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
        appointment,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("PUBLIC_CREATE_BOOKING_ERROR", error);

    return NextResponse.json(
      { error: "Failed to create booking" },
      { status: 500 }
    );
  }
}