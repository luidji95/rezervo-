export type WorkingHour = {
  id: string;
  salon_id: string;
  employee_id: string | null;
  day_of_week: number;
  opens_at: string;
  closes_at: string;
  break_starts_at: string | null;
  break_ends_at: string | null;
  is_working_day: boolean;
  created_at: string;
  updated_at: string;
};

export type CreateWorkingHourPayload = {
  salon_id: string;
  employee_id?: string | null;
  day_of_week: number;
  opens_at: string;
  closes_at: string;
  break_starts_at?: string | null;
  break_ends_at?: string | null;
  is_working_day: boolean;
};

export type UpdateWorkingHourPayload = Partial<
  Omit<CreateWorkingHourPayload, "salon_id" | "employee_id" | "day_of_week">
>;