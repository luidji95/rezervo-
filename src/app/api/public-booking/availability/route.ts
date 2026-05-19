import { NextRequest, NextResponse } from "next/server";

import { generateAvailableSlots } from "@/services/availabilityService";
import { supabaseServer } from "@/lib/supabaseServer";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const { salonId, employeeId, serviceId, date } = body;

    console.log("PUBLIC AVAILABILITY BODY:", {
      salonId,
      employeeId,
      serviceId,
      date,
    });

    if (!salonId || !employeeId || !serviceId || !date) {
      return NextResponse.json(
        {
          success: false,
          error: "Missing required fields.",
        },
        {
          status: 400,
        }
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
      debug: {
        salonId,
        employeeId,
        serviceId,
        date,
        slotsCount: result.slots.length,
      },
    });
  } catch (error) {
    console.error("PUBLIC AVAILABILITY ERROR:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to generate available slots.",
      },
      {
        status: 500,
      }
    );
  }
}