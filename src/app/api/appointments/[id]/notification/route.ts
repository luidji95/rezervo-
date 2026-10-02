import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedRequestUser } from "@/lib/server/requestAuth";
import { supabaseServer } from "@/lib/supabaseServer";
import { createNotification, formatNotificationAppointmentTime, type NotificationType } from "@/services/notificationService";

const paramsSchema = z.object({ id: z.string().uuid() });
const bodySchema = z.object({
  eventType: z.enum([
    "appointment_created",
    "appointment_cancelled",
    "appointment_confirmed",
    "appointment_completed",
    "appointment_rescheduled",
    "appointment_no_show",
  ]),
}).strict();

const eventConfig: Record<NotificationType, { title: string; requiredStatus?: string }> = {
  appointment_created: { title: "Novi termin" },
  appointment_cancelled: { title: "Termin otkazan", requiredStatus: "cancelled" },
  appointment_confirmed: { title: "Termin potvrđen", requiredStatus: "confirmed" },
  appointment_completed: { title: "Termin završen", requiredStatus: "completed" },
  appointment_rescheduled: { title: "Termin pomeren", requiredStatus: "confirmed" },
  appointment_no_show: { title: "Klijent se nije pojavio", requiredStatus: "no_show" },
};

function response(code: string, status: number) {
  return NextResponse.json({ success: false, code }, { status });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const [params, body, auth] = await Promise.all([
    context.params,
    request.json().catch(() => null),
    getAuthenticatedRequestUser(request),
  ]);
  const parsedParams = paramsSchema.safeParse(params);
  const parsedBody = bodySchema.safeParse(body);
  if (!parsedParams.success || !parsedBody.success) return response("INVALID_INPUT", 400);
  if (!auth.ok) return response("UNAUTHORIZED", 401);

  const { data: appointment, error: appointmentError } = await supabaseServer
    .from("appointments")
    .select("id,salon_id,status,start_time,created_at,updated_at")
    .eq("id", parsedParams.data.id)
    .maybeSingle();
  if (appointmentError || !appointment) return response("APPOINTMENT_NOT_FOUND", 404);

  const [{ data: salon }, { data: membership }] = await Promise.all([
    supabaseServer.from("salons").select("owner_id").eq("id", appointment.salon_id).maybeSingle(),
    supabaseServer.from("salon_members").select("id").eq("salon_id", appointment.salon_id).eq("profile_id", auth.user.id).eq("role", "owner").eq("status", "active").maybeSingle(),
  ]);
  if (salon?.owner_id !== auth.user.id && !membership) return response("FORBIDDEN", 403);

  const { data: accessData, error: accessError } = await supabaseServer.rpc(
    "resolve_salon_access_v1",
    { p_salon_id: appointment.salon_id },
  );
  const access = (accessData as { has_full_access: boolean }[] | null)?.[0];
  if (accessError || access?.has_full_access !== true) {
    return response("APPOINTMENT_ACCESS_REQUIRED", 403);
  }

  const config = eventConfig[parsedBody.data.eventType];
  if (config.requiredStatus && appointment.status !== config.requiredStatus) return response("EVENT_STATUS_MISMATCH", 409);

  // Create/status events are final per type. Reschedule can repeat, so only
  // deduplicate a retry for the current appointment update.
  let duplicateQuery = supabaseServer
    .from("notifications")
    .select("id")
    .eq("salon_id", appointment.salon_id)
    .eq("type", parsedBody.data.eventType)
    .eq("entity_type", "appointment")
    .eq("entity_id", appointment.id)
    .limit(1);
  if (parsedBody.data.eventType === "appointment_rescheduled") {
    duplicateQuery = duplicateQuery.gte("created_at", appointment.updated_at);
  }
  const { data: existing } = await duplicateQuery.maybeSingle();
  if (existing) return NextResponse.json({ success: true, notificationId: existing.id, duplicate: true });

  const notification = await createNotification({
    salonId: appointment.salon_id,
    type: parsedBody.data.eventType,
    title: config.title,
    message: `${config.title}: ${formatNotificationAppointmentTime(appointment.start_time)}.`,
    entityType: "appointment",
    entityId: appointment.id,
  }, supabaseServer);

  if (!notification) return response("NOTIFICATION_CREATE_FAILED", 500);
  return NextResponse.json({ success: true, notificationId: notification.id, duplicate: false }, { status: 201 });
}
