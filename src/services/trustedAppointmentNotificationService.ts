import { supabase } from "@/lib/supabase/client";
import type { NotificationType } from "@/services/notificationService";

export async function createTrustedAppointmentNotification(appointmentId: string, eventType: NotificationType) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("UNAUTHORIZED");

  const response = await fetch(`/api/appointments/${encodeURIComponent(appointmentId)}/notification`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ eventType }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null) as { code?: string } | null;
    if (process.env.NODE_ENV === "development") {
      console.error("TRUSTED_APPOINTMENT_NOTIFICATION_FAILED", {
        status: response.status,
        code: body?.code ?? null,
        appointmentIdPresent: Boolean(appointmentId),
        eventType,
      });
    }
    throw new Error(body?.code ?? "NOTIFICATION_CREATE_FAILED");
  }
}
