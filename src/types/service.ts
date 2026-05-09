// src/types/service.ts

export type Service = {
  id: string;
  salon_id: string;
  category_id: string | null;
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
  created_at: string;
  updated_at: string;
};

export type CreateServiceInput = {
  salonId: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  priceAmount: number;
};
export type UpdateServiceInput = {
  serviceId: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  priceAmount: number;
};