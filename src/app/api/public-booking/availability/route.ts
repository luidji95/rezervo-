import { NextRequest, NextResponse } from "next/server";

import { generateAvailableSlots } from "@/services/availabilityService";

import { supabaseServer } from "@/lib/supabaseServer";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const { salonId, employeeId, serviceId, date } = body;

    if (!salonId || !employeeId || !serviceId || !date) {
      return NextResponse.json(
        {
          error: "Missing required fields.",
        },
        {
          status: 400,
        }
      );
    }

    const slots = await generateAvailableSlots(
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
      slots: slots.slots,
    });
  } catch (error) {
    console.error("PUBLIC AVAILABILITY ERROR:", error);

    return NextResponse.json(
      {
        error: "Failed to generate available slots.",
      },
      {
        status: 500,
      }
    );
  }
}