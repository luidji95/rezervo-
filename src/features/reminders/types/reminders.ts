export type ReminderChannel = "sms" | "viber";
export type ReminderDeliveryStatus = "pending" | "processing" | "sent" | "delivered" | "retry_scheduled" | "failed" | "skipped" | "cancelled";

export type ReminderSettings = {
  salonId: string;
  enabled: boolean;
  channel: ReminderChannel;
  hoursBefore: number;
};

export type ReminderClaim = {
  deliveryId: string;
  salonId: string;
  appointmentId: string;
  clientId: string | null;
  channel: ReminderChannel;
  scheduledFor: string;
  appointmentStart: string;
  recipient: string;
  salonTimezone: string;
  attemptCount: number;
  leaseExpiresAt: string;
  claimToken: string;
};

export type ReminderUsage = {
  salonId: string;
  periodStart: string;
  periodEnd: string;
  acceptedCount: number;
  maxMonthlyReminders: number | null;
  remaining: number | null;
};
