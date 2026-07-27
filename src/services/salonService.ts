import { supabase } from "@/lib/supabase/client";
import type { UpdateSalonInput } from "@/types/salon";

type PrimarySalonBootstrapRow = {
  salon_id: string;
  was_created: boolean;
  salon_name: string;
  salon_slug: string;
  onboarding_completed: boolean;
  onboarding_step: number;
  trial_ends_at: string;
};

type SaveOnboardingSalonInput = {
  salonId?: string;
  ownerId: string;
  name: string;
  businessType: string;
  phone: string;
  email: string;
  addressLine: string;
  websiteUrl: string;
  instagramUrl: string;
  description: string;
};

const CURRENT_SALON_SELECT = `
  id,
  owner_id,
  name,
  slug,
  description,
  short_description,
  logo_url,
  cover_image_url,
  phone,
  email,
  website_url,
  address_line,
  city,
  country,
  business_type,
  status,
  timezone,
  default_currency,
  booking_enabled,
  online_booking_enabled,
  public_booking_url,
  onboarding_completed,
  onboarding_step,
  instagram_url,
  facebook_url,
  tiktok_url,
  created_at
`;

function generateSlug(name: string) {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[ćč]/g, "c")
    .replace(/š/g, "s")
    .replace(/đ/g, "dj")
    .replace(/ž/g, "z")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "salon";
}

export async function generateUniqueSalonSlug(
  name: string,
  excludeSalonId?: string
) {
  const baseSlug = generateSlug(name);
  let candidate = baseSlug;
  let suffix = 2;

  while (true) {
    let query = supabase
      .from("salons")
      .select("id")
      .eq("slug", candidate)
      .limit(1);

    if (excludeSalonId) {
      query = query.neq("id", excludeSalonId);
    }

    const { data, error } = await query;

    if (error) {
      throw error;
    }

    if (!data?.length) {
      return candidate;
    }

    candidate = `${baseSlug}-${suffix}`;
    suffix += 1;
  }
}

async function createPrimarySalonOnce(input: Omit<SaveOnboardingSalonInput, "salonId" | "ownerId">) {
  const { data, error } = await supabase
    .rpc("create_primary_salon_once_v1", {
      p_name: input.name,
      p_slug_candidate: generateSlug(input.name),
      p_business_type: input.businessType,
      p_phone: input.phone || null,
      p_email: input.email || null,
      p_address_line: input.addressLine || null,
      p_website_url: input.websiteUrl || null,
      p_instagram_url: input.instagramUrl || null,
      p_description: input.description || null,
    })
    .single();
  if (error) throw error;
  const row = data as PrimarySalonBootstrapRow;
  return {
    id: row.salon_id,
    name: row.salon_name,
    slug: row.salon_slug,
    onboarding_completed: row.onboarding_completed,
    onboarding_step: row.onboarding_step,
    was_created: row.was_created,
    trial_ends_at: row.trial_ends_at,
  };
}

export async function saveOnboardingSalon({
  salonId,
  ownerId,
  name,
  businessType,
  phone,
  email,
  addressLine,
  websiteUrl,
  instagramUrl,
  description,
}: SaveOnboardingSalonInput) {
  void ownerId;

  if (salonId) {
    const slug = await generateUniqueSalonSlug(name, salonId);
    const { data, error } = await supabase.rpc("update_onboarding_salon_v1", {
      p_salon_id: salonId,
      p_name: name,
      p_slug: slug,
      p_business_type: businessType,
      p_phone: phone || null,
      p_email: email || null,
      p_address_line: addressLine || null,
      p_website_url: websiteUrl || null,
      p_instagram_url: instagramUrl || null,
      p_description: description || null,
    });

    if (error) {
      throw error;
    }

    return data;
  }
  return createPrimarySalonOnce({ name, businessType, phone, email, addressLine, websiteUrl, instagramUrl, description });
}

export async function completeOnboardingSetup(salonId: string) {
  const { data, error } = await supabase.rpc("set_salon_onboarding_state_v1", {
    p_salon_id: salonId, p_completed: true, p_step: 5,
  });

  if (error) {
    throw error;
  }

  return data;
}

export async function updateOnboardingProgress(
  salonId: string,
  onboardingStep: number
) {
  const { data, error } = await supabase.rpc("set_salon_onboarding_state_v1", {
    p_salon_id: salonId, p_completed: false, p_step: onboardingStep,
  });

  if (error) {
    throw error;
  }

  return data;
}

export async function getMySalon(profileId: string) {
  const { data, error } = await supabase
    .from("salons")
    .select("id, name, slug, onboarding_completed, onboarding_step")
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
    .select(CURRENT_SALON_SELECT)
    .eq("owner_id", profileId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

export async function getSalonById(salonId: string) {
  const { data, error } = await supabase
    .from("salons")
    .select(CURRENT_SALON_SELECT)
    .eq("id", salonId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

export type CurrentSalon = Awaited<ReturnType<typeof getCurrentSalon>>;

export async function updateCurrentSalon({
  salonId,
  name,
  phone,
  email,
  websiteUrl,
  instagramUrl,
  city,
  addressLine,
  description,
}: UpdateSalonInput) {
  const { data, error } = await supabase.rpc("update_salon_profile_v1", {
    p_salon_id: salonId, p_name: name, p_phone: phone, p_email: email,
    p_website_url: websiteUrl || null, p_instagram_url: instagramUrl || null,
    p_city: city || null, p_address_line: addressLine, p_description: description || null,
  });

  if (error) {
    throw error;
  }

  return data;
}
