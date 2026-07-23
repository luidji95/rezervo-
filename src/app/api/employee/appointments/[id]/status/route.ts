import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedRequestUser } from "@/lib/server/requestAuth";
import { supabaseServer } from "@/lib/supabaseServer";
import {
  createNotification,
  formatNotificationAppointmentTime,
  type NotificationType,
} from "@/services/notificationService";

const paramsSchema = z.object({ id: z.string().uuid() });
const bodySchema = z
  .object({
    status: z.enum(["confirmed", "completed", "cancelled", "no_show"]),
  })
  .strict();

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ success: false, code, message }, { status });
}

const notificationByStatus: Record<
  string,
  { type: NotificationType; title: string }
> = {
  confirmed: { type: "appointment_confirmed", title: "Termin je potvrđen" },
  completed: { type: "appointment_completed", title: "Termin je završen" },
  cancelled: { type: "appointment_cancelled", title: "Termin je otkazan" },
  no_show: { type: "appointment_no_show", title: "Klijent se nije pojavio" },
};

function mapRpcError(error: { code?: string; message?: string }) {
  const code = error.message?.trim();
  if (code === "FORBIDDEN") {
    return errorResponse("FORBIDDEN", "Nemate dozvolu za ovu akciju.", 403);
  }
  if (code === "APPOINTMENT_NOT_FOUND") {
    return errorResponse("APPOINTMENT_NOT_FOUND", "Termin nije pronađen.", 404);
  }
  if (
    code === "INVALID_STATUS_TRANSITION" ||
    code === "APPOINTMENT_ALREADY_UPDATED"
  ) {
    return errorResponse(
      code,
      "Status termina je u međuvremenu promenjen. Osvežite podatke.",
      409,
    );
  }
  return errorResponse("UPDATE_FAILED", "Status trenutno nije moguće promeniti.", 500);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const parsedParams = paramsSchema.safeParse(await context.params);
  const parsedBody = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsedParams.success || !parsedBody.success) {
    return errorResponse("INVALID_INPUT", "Zahtev nije ispravan.", 400);
  }

  const authResult = await getAuthenticatedRequestUser(request);
  if (!authResult.ok) {
    return errorResponse("UNAUTHORIZED", "Morate biti prijavljeni.", 401);
  }

  const { data, error } = await supabaseServer.rpc(
    "update_employee_appointment_status",
    {
      p_appointment_id: parsedParams.data.id,
      p_profile_id: authResult.user.id,
      p_next_status: parsedBody.data.status,
    },
  );

  if (error) return mapRpcError(error);

  const updateResult = Array.isArray(data) ? data[0] : null;
  if (!updateResult) {
    return errorResponse("UPDATE_FAILED", "Status trenutno nije moguće promeniti.", 500);
  }

  const notification = notificationByStatus[parsedBody.data.status];
  if (notification) {
    const { data: appointment } = await supabaseServer
      .from("appointments")
      .select("id, salon_id, start_time")
      .eq("id", parsedParams.data.id)
      .maybeSingle();

    if (appointment) {
      await createNotification(
        {
          salonId: appointment.salon_id,
          type: notification.type,
          title: notification.title,
          message: `Termin ${formatNotificationAppointmentTime(appointment.start_time)} je ažuriran.`,
          entityType: "appointment",
          entityId: appointment.id,
        },
        supabaseServer,
      ).catch(() => null);
    }
  }

  return NextResponse.json({
    success: true,
    appointment: {
      id: updateResult.appointment_id,
      status: updateResult.new_status,
    },
  });
}
