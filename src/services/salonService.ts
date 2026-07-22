import { supabase } from "@/lib/supabase/client";
import type { UpdateSalonInput } from "@/types/salon";

type CreateSalonInput = {
  name: string;
  phone: string;
  city: string;
  addressLine: string;
  ownerId: string;
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

const ONBOARDING_SALON_SELECT =
  "id, name, slug, onboarding_completed, onboarding_step";

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

export async function createSalonWithOwner({
  name,
  phone,
  city,
  addressLine,
  ownerId,
}: CreateSalonInput) {
  const slug = await generateUniqueSalonSlug(name);

  const { data: salon, error: salonError } = await supabase
    .from("salons")
    .insert({
      owner_id: ownerId,
      name,
      slug,
      phone,
      city,
      address_line: addressLine,
      onboarding_completed: true,
      onboarding_step: 1,
    })
    .select("id, name, slug, onboarding_completed, onboarding_step")
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
  const slug = await generateUniqueSalonSlug(name, salonId);
  const payload = {
    name,
    slug,
    business_type: businessType,
    phone: phone || null,
    email: email || null,
    address_line: addressLine || null,
    website_url: websiteUrl || null,
    instagram_url: instagramUrl || null,
    description: description || null,
    onboarding_completed: true,
    onboarding_step: 1,
  };

  console.log("Salon payload:", payload);

  if (salonId) {
    const { data, error } = await supabase
      .from("salons")
      .update(payload)
      .eq("id", salonId)
      .select(ONBOARDING_SALON_SELECT)
      .single();

    if (error) {
      console.log("Supabase error full:", JSON.stringify(error, null, 2));
      console.log("Supabase error parts:", {
        message: error?.message,
        details: error?.details,
        hint: error?.hint,
        code: error?.code,
      });
      throw error;
    }

    return data;
  }

  const { data: salon, error: salonError } = await supabase
    .from("salons")
    .insert({
      owner_id: ownerId,
      ...payload,
    })
    .select(ONBOARDING_SALON_SELECT)
    .single();

  if (salonError) {
    console.log("Supabase error full:", JSON.stringify(salonError, null, 2));
    console.log("Supabase error parts:", {
      message: salonError?.message,
      details: salonError?.details,
      hint: salonError?.hint,
      code: salonError?.code,
    });
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

export async function completeOnboardingSetup(salonId: string) {
  const { data, error } = await supabase
    .from("salons")
    .update({
      onboarding_completed: true,
      onboarding_step: 5,
    })
    .eq("id", salonId)
    .select(ONBOARDING_SALON_SELECT)
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function updateOnboardingProgress(
  salonId: string,
  onboardingStep: number
) {
  const { data, error } = await supabase
    .from("salons")
    .update({
      onboarding_completed: false,
      onboarding_step: onboardingStep,
    })
    .eq("id", salonId)
    .select(ONBOARDING_SALON_SELECT)
    .single();

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
  const { data, error } = await supabase
    .from("salons")
    .update({
      name,
      phone,
      email,
      website_url: websiteUrl || null,
      instagram_url: instagramUrl || null,
      city: city || null,
      address_line: addressLine,
      description: description || null,
    })
    .eq("id", salonId)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}
