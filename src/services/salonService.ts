import { supabase } from "@/lib/supabase/client";
import type { UpdateSalonInput } from "@/types/salon";

type CreateSalonInput = {
  name: string;
  phone: string;
  city: string;
  addressLine: string;
  ownerId: string;
};

function generateSlug(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/ć/g, "c")
    .replace(/č/g, "c")
    .replace(/š/g, "s")
    .replace(/đ/g, "dj")
    .replace(/ž/g, "z")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function createSalonWithOwner({
  name,
  phone,
  city,
  addressLine,
  ownerId,
}: CreateSalonInput) {
  const slug = generateSlug(name);

  console.log("SALON INSERT PAYLOAD:", {
  owner_id: ownerId,
  name,
  slug,
  phone,
  city,
  address_line: addressLine,
});

const { data: salon, error: salonError } = await supabase
  .from("salons")
  .insert({
    owner_id: ownerId,
    name,
    slug,
    phone,
    city,
    address_line: addressLine,
  })
  .select("id")
  .single();

  if (salonError) {
    throw salonError;
  }

  const { error: memberError } = await supabase.from("salon_members").insert({
    salon_id: salon.id,
    profile_id: ownerId,
    role: "owner",
    status: "active",
    joined_at: new Date().toISOString(),
  });

  if (memberError) {
    throw memberError;
  }

  return salon;
}

export async function getMySalon(profileId: string) {
  const { data, error } = await supabase
    .from("salons")
    .select("id, name, slug")
    .eq("owner_id", profileId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

export async function getCurrentSalon(profileId: string) {
  const { data, error } = await supabase
    .from("salons")
    .select(`
      id,
      owner_id,
      name,
      slug,
      phone,
      email,
      address_line,
      city,
      country,
      business_type,
      status,
      timezone,
      default_currency,
      booking_enabled,
      online_booking_enabled,
      created_at
    `)
    .eq("owner_id", profileId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}



export async function updateCurrentSalon({
  salonId,
  name,
  phone,
  email,
  websiteUrl,
  city,
  addressLine,
}: UpdateSalonInput) {
  const { data, error } = await supabase
    .from("salons")
    .update({
      name,
      phone,
      email,
      website_url: websiteUrl,
      city,
      address_line: addressLine,
    })
    .eq("id", salonId)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}