export type ClientStatus = "active" | "inactive";

export type Client = {
  id: string;
  salon_id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  source: string | null;
  created_at: string;
  updated_at?: string | null;
  status?: ClientStatus | null;
};

export type CreateClientInput = {
  salonId: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  source?: string | null;
};

export type UpdateClientInput = {
  clientId: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  source?: string | null;
};
