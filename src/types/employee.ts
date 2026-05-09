export type Employee = {
  id: string;
  salon_id: string;
  profile_id: string | null;

  full_name: string;
  display_name: string | null;
  public_slug: string | null;
  bio: string | null;

  position: string | null;

  avatar_url: string | null;
  phone: string | null;
  email: string | null;

  is_active: boolean;
  is_bookable: boolean;
  is_public: boolean;

  sort_order: number;

  created_at: string;
  updated_at: string;
};

export type CreateEmployeeInput = {
  salonId: string;

  fullName: string;
  displayName: string | null;

  position: string | null;

  phone: string | null;
  email: string | null;

  bio: string | null;
};

export type UpdateEmployeeInput = {
  employeeId: string;

  fullName: string;
  displayName: string | null;

  position: string | null;

  phone: string | null;
  email: string | null;

  bio: string | null;
};