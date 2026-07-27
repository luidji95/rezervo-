import { supabase } from "@/lib/supabase/client";
import type {
  Client,
  CreateClientInput,
  UpdateClientInput,
} from "@/types/client";
import { throwBusinessDataMutationError } from "@/features/business-data/services/businessDataMutationError";

type SupabaseClientLike = typeof supabase;

export function normalizeClientPhone(value?: string | null) {
  return value?.trim().replace(/[\s()\-]/g, "") || null;
}

export function normalizeClientEmail(value?: string | null) {
  return value?.trim().toLowerCase() || null;
}

export async function findOrCreateSalonClient(
  {
    salonId,
    fullName,
    phone,
    email,
    source,
  }: {
    salonId: string;
    fullName: string;
    phone?: string;
    email?: string;
    source: string;
  },
  supabaseClient: SupabaseClientLike = supabase
): Promise<string> {
  const normalizedPhone = normalizeClientPhone(phone);
  const normalizedEmail = normalizeClientEmail(email);
  const { data: salonClients, error: lookupError } = await supabaseClient
    .from("clients")
    .select("id, phone, email")
    .eq("salon_id", salonId);

  if (lookupError) {
    throw new Error("Failed to check existing salon clients.");
  }

  const clientByPhone = normalizedPhone
    ? salonClients?.find(
        (client) => normalizeClientPhone(client.phone) === normalizedPhone
      )
    : null;
  const clientByEmail = normalizedEmail
    ? salonClients?.find(
        (client) => normalizeClientEmail(client.email) === normalizedEmail
      )
    : null;
  const existingClient = clientByPhone ?? clientByEmail;

  if (existingClient) {
    return existingClient.id;
  }

  const { data: createdClient, error: createError } = await supabaseClient
    .from("clients")
    .insert({
      salon_id: salonId,
      full_name: fullName.trim(),
      phone: normalizedPhone,
      email: normalizedEmail,
      source,
    })
    .select("id")
    .single();

  if (createError || !createdClient) {
    throw new Error("Failed to create client.");
  }

  return createdClient.id;
}

const CLIENT_SELECT = `
  id,
  salon_id,
  full_name,
  phone,
  email,
  source,
  created_at
`;

export async function getSalonClients(salonId: string): Promise<Client[]> {
  const { data, error } = await supabase
    .from("clients")
    .select(CLIENT_SELECT)
    .eq("salon_id", salonId)
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  return (data ?? []) as Client[];
}

export async function createClient({
  salonId,
  fullName,
  phone,
  email,
  source = "manual",
}: CreateClientInput): Promise<Client> {
  const { data, error } = await supabase.rpc("create_owner_client_v1", {
    p_salon_id: salonId, p_full_name: fullName, p_phone: phone,
    p_email: email, p_source: source ?? "manual",
  });
  if (error) throwBusinessDataMutationError(error);

  return data as Client;
}

export async function updateClient({
  clientId,
  fullName,
  phone,
  email,
  source,
}: UpdateClientInput): Promise<Client> {
  const { data, error } = await supabase.rpc("update_owner_client_v1", {
    p_client_id: clientId, p_full_name: fullName, p_phone: phone,
    p_email: email, p_source: source ?? "manual", p_notes: null,
  });
  if (error) throwBusinessDataMutationError(error);

  return data as Client;
}

export async function deleteClient(clientId: string): Promise<void> {
  const { error } = await supabase.rpc("delete_client_safely_v1", { p_client_id: clientId });
  if (error) throwBusinessDataMutationError(error);
}
