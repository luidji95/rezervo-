// src/types/service.ts
import type { SmsHumorCategory, SmsTemplateSet } from "@/features/public-booking/sms/bookingConfirmationSmsStyles";

export type Service = {
  id: string;
  salon_id: string;
  category_id: string | null;
  category_name: string | null;
  name: string;
  description: string | null;
  duration_minutes: number;
  buffer_minutes: number;
  price: number;
  currency: string;
  is_active: boolean;
  is_public: boolean;
  color: string | null;
  sort_order: number;
  // Template set for the playful confirmation SMS; null is universal.
  sms_humor_category: SmsHumorCategory | null;
  created_at: string;
  updated_at: string;
};

export type CreateServiceInput = {
  salonId: string;
  name: string;
  description: string | null;
  categoryName: string | null;
  durationMinutes: number;
  priceAmount: number;
  isActive?: boolean;
  isPublic?: boolean;
  smsHumorCategory?: SmsTemplateSet;
};
export type UpdateServiceInput = {
  serviceId: string;
  name: string;
  description: string | null;
  categoryName: string | null;
  durationMinutes: number;
  priceAmount: number;
  isActive?: boolean;
  isPublic?: boolean;
  // Omitted keeps the stored category; "universal" clears it.
  smsHumorCategory?: SmsTemplateSet;
};
