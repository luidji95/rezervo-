import { supabase } from "@/lib/supabase/client";

type SupabaseClientLike = typeof supabase;

export type NotificationType =
  | "appointment_created"
  | "appointment_cancelled"
  | "appointment_confirmed"
  | "appointment_completed"
  | "appointment_rescheduled"
  | "appointment_no_show";

export type AppNotification = {
  id: string;
  salon_id: string;
  type: NotificationType;
  title: string;
  message: string;
  entity_type: string | null;
  entity_id: string | null;
  is_read: boolean;
  created_at: string;
};

type CreateNotificationInput = {
  salonId: string;
  type: NotificationType;
  title: string;
  message: string;
  entityType?: string;
  entityId?: string;
};

export async function createNotification(
  input: CreateNotificationInput,
  supabaseClient: SupabaseClientLike = supabase
) {
  const { data, error } = await supabaseClient
    .from("notifications")
    .insert({
      salon_id: input.salonId,
      type: input.type,
      title: input.title,
      message: input.message,
      entity_type: input.entityType ?? null,
      entity_id: input.entityId ?? null,
    })
    .select("*")
    .single();

  if (error) {
    console.error("Failed to create notification:", error.message);
    return null;
  }

  const notification = { ...data, is_read: false } as AppNotification;

  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("rezervo:notification", { detail: notification })
    );
  }

  return notification;
}

export async function getNotifications(salonId: string, limit = 30) {
  const [{ data, error }, { count, error: countError }] = await Promise.all([
    supabase
      .from("notification_recipients")
      .select(`
        is_read,
        notifications!inner(
          id,
          salon_id,
          type,
          title,
          message,
          entity_type,
          entity_id,
          created_at
        )
      `)
      .eq("notifications.salon_id", salonId)
      .order("created_at", { referencedTable: "notifications", ascending: false })
      .limit(limit),
    supabase
      .from("notification_recipients")
      .select("id, notifications!inner(id)", { count: "exact", head: true })
      .eq("notifications.salon_id", salonId)
      .eq("is_read", false),
  ]);

  if (error) throw new Error(error.message);
  if (countError) throw new Error(countError.message);

  const notifications = (data ?? []).map((recipient) => {
    const notification = recipient.notifications as unknown as Omit<
      AppNotification,
      "is_read"
    >;
    return { ...notification, is_read: recipient.is_read };
  });

  return {
    notifications,
    unreadCount: count ?? 0,
  };
}

export async function markNotificationAsRead(notificationId: string) {
  const { error } = await supabase
    .from("notification_recipients")
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq("notification_id", notificationId)
    .eq("is_read", false);

  if (error) throw new Error(error.message);
}

export async function markAllNotificationsAsRead(salonId: string) {
  const { data: recipients, error: lookupError } = await supabase
    .from("notification_recipients")
    .select("id, notifications!inner(id)")
    .eq("notifications.salon_id", salonId)
    .eq("is_read", false);

  if (lookupError) throw new Error(lookupError.message);

  const recipientIds = (recipients ?? []).map((recipient) => recipient.id);
  if (recipientIds.length === 0) return;

  const { error } = await supabase
    .from("notification_recipients")
    .update({ is_read: true, read_at: new Date().toISOString() })
    .in("id", recipientIds);

  if (error) throw new Error(error.message);
}

export function subscribeToNotifications(
  salonId: string,
  onInsert: () => void
) {
  const channel = supabase
    .channel(`notifications:${salonId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "notifications",
        filter: `salon_id=eq.${salonId}`,
      },
      () => onInsert()
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}

export function formatNotificationAppointmentTime(dateString: string) {
  return new Intl.DateTimeFormat("sr-RS", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Belgrade",
  }).format(new Date(dateString));
}
