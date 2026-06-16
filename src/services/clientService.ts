import { supabase } from "@/lib/supabase/client";
import type {
  Client,
  CreateClientInput,
  UpdateClientInput,
} from "@/types/client";

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
  const { data, error } = await supabase
    .from("clients")
    .insert({
      salon_id: salonId,
      full_name: fullName.trim(),
      phone: phone?.trim() || null,
      email: email?.trim() || null,
      source,
    })
    .select(CLIENT_SELECT)
    .single();

  if (error) {
    throw error;
  }

  return data as Client;
}

export async function updateClient({
  clientId,
  fullName,
  phone,
  email,
  source,
}: UpdateClientInput): Promise<Client> {
  const { data, error } = await supabase
    .from("clients")
    .update({
      full_name: fullName.trim(),
      phone: phone?.trim() || null,
      email: email?.trim() || null,
      source: source || null,
    })
    .eq("id", clientId)
    .select(CLIENT_SELECT)
    .single();

  if (error) {
    throw error;
  }

  return data as Client;
}

export async function deleteClient(clientId: string): Promise<void> {
  const { error } = await supabase.from("clients").delete().eq("id", clientId);

  if (error) {
    throw error;
  }
}
