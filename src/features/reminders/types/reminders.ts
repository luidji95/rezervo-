import type { SmsConfirmationStyle } from "@/features/public-booking/sms/bookingConfirmationSmsStyles";

export type ReminderChannel = "sms" | "viber";
export type ReminderDeliveryStatus = "pending" | "processing" | "sent" | "delivered" | "retry_scheduled" | "failed" | "skipped" | "cancelled";

// smsEnabled: main switch (confirmations, and reminders together with reminderEnabled).
export type SalonSmsSettings = {
  salonId: string;
  smsEnabled: boolean;
  reminderEnabled: boolean;
  channel: ReminderChannel;
  hoursBefore: number;
  // Null: the salon has not chosen a style and gets the standard confirmation text.
  confirmationStyle: SmsConfirmationStyle | null;
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
