export type TeamRole = "owner" | "manager" | "receptionist" | "employee";

export type SalonMember = {
  id: string;
  salon_id: string;
  profile_id: string;
  role: TeamRole | string;
  status: string;
  joined_at: string | null;
};

export type TeamProfile = {
  id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
};
