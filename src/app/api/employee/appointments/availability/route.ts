import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedRequestUser } from "@/lib/server/requestAuth";
import {
  getEmployeeAppointmentAccessError,
  getEmployeeAppointmentContext,
} from "@/lib/server/employeeAppointmentContext";
import { supabaseServer } from "@/lib/supabaseServer";
import { generateAvailableSlots } from "@/services/availabilityService";

const schema = z.object({
  serviceId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }),
}).strict();

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, code: "INVALID_INPUT" }, { status: 400 });
  }

  const auth = await getAuthenticatedRequestUser(request);
  if (!auth.ok) {
    return NextResponse.json({ success: false, code: "UNAUTHORIZED" }, { status: 401 });
  }

  const baseContext = await getEmployeeAppointmentContext(auth.user.id);
  if (!baseContext) {
    const code = await getEmployeeAppointmentAccessError(auth.user.id);
    return NextResponse.json({ success: false, code }, { status: 403 });
  }
  const context = await getEmployeeAppointmentContext(auth.user.id, parsed.data.serviceId);
  if (!context) {
    return NextResponse.json({ success: false, code: "SERVICE_NOT_ASSIGNED" }, { status: 404 });
  }

  try {
    const availability = await generateAvailableSlots(
      {
        salonId: context.salonId,
        employeeId: context.employeeId,
        serviceId: parsed.data.serviceId,
        date: parsed.data.date,
      },
      supabaseServer,
    );
    return NextResponse.json({ success: true, slots: availability.slots });
  } catch {
    return NextResponse.json({ success: false, code: "AVAILABILITY_FAILED" }, { status: 500 });
  }
}
