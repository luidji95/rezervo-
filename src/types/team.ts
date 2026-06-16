export type TeamRole = "owner" | "manager" | "receptionist" | "employee";

export type SalonMember = {
  id: string;
  salon_id: string;
  profile_id: string;
  role: TeamRole | string;
  status: string;
  joined_at: string | null;
};
