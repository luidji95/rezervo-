export type Closure = {
  id: string;
  salon_id: string;
  employee_id: string | null;
  title: string;
  reason: string | null;
  starts_at: string;
  ends_at: string;
  is_full_day: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type CreateClosurePayload = {
  salon_id: string;
  employee_id?: string | null;
  title: string;
  reason?: string | null;
  starts_at: string;
  ends_at: string;
  is_full_day: boolean;
  created_by?: string | null;
};