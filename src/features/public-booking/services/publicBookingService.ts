import { supabase } from "@/lib/supabase/client";

import type {
  CreatePublicBookingInput,
  CreatePublicBookingResult,
  PublicAvailabilityInput,
  PublicAvailabilitySlot,
  PublicEmployee,
  PublicSalon,
  PublicSalonPageData,
  PublicService,
} from "../types";

export class PublicBookingConflictError extends Error {
  constructor() {
    super("Selected booking slot is no longer available.");
    this.name = "PublicBookingConflictError";
  }
}

function isPublicAvailabilitySlot(
  value: unknown
): value is PublicAvailabilitySlot {
  if (!value || typeof value !== "object") return false;

  const slot = value as Record<string, unknown>;
  return (
    typeof slot.startTime === "string" &&
    typeof slot.endTime === "string" &&
    typeof slot.employeeId === "string"
  );
}

const PUBLIC_SALON_FIELDS = `
  id,
  name,
  slug,
  logo_url,
  cover_image_url,
  description,
  short_description,
  address_line,
  city,
  phone,
  email,
  website_url,
  instagram_url,
  timezone
`;

const PUBLIC_SERVICE_FIELDS = `
  id,
  name,
  description,
  duration_minutes,
  price,
  currency
`;

type PublicSalonRow = {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  cover_image_url: string | null;
  description: string | null;
  short_description: string | null;
  address_line: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  website_url: string | null;
  instagram_url: string | null;
  timezone: string | null;
};

type PublicServiceRow = {
  id: string;
  name: string;
  description: string | null;
  duration_minutes: number;
  price: number;
  currency: string | null;
};

type PublicEmployeeRow = {
  id: string;
  full_name: string;
  display_name: string | null;
  position: string | null;
  avatar_url: string | null;
  bio: string | null;
};

function mapSalon(row: PublicSalonRow): PublicSalon {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    logoUrl: row.logo_url,
    coverImageUrl: row.cover_image_url,
    description: row.description,
    shortDescription: row.short_description,
    addressLine: row.address_line,
    city: row.city,
    phone: row.phone,
    email: row.email,
    websiteUrl: row.website_url,
    instagramUrl: row.instagram_url,
    timezone: row.timezone || "Europe/Belgrade",
  };
}

function mapService(row: PublicServiceRow): PublicService {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    durationMinutes: row.duration_minutes,
    price: Number(row.price),
    currency: row.currency || "EUR",
  };
}

export async function getPublicSalonPageData(
  slug: string
): Promise<PublicSalonPageData | null> {
  const normalizedSlug = slug.trim();

  if (!normalizedSlug) {
    return null;
  }

  const { data: salonData, error: salonError } = await supabase
    .from("salons")
    .select(PUBLIC_SALON_FIELDS)
    .eq("slug", normalizedSlug)
    .eq("status", "active")
    .eq("booking_enabled", true)
    .eq("online_booking_enabled", true)
    .maybeSingle();

  if (salonError) {
    throw new Error("Failed to load public salon.", { cause: salonError });
  }

  if (!salonData) {
    return null;
  }

  const salonRow = salonData as PublicSalonRow;
  const { data: servicesData, error: servicesError } = await supabase
    .from("services")
    .select(PUBLIC_SERVICE_FIELDS)
    .eq("salon_id", salonRow.id)
    .eq("is_active", true)
    .eq("is_public", true)
    .order("sort_order", { ascending: true });

  if (servicesError) {
    throw new Error("Failed to load public services.", {
      cause: servicesError,
    });
  }

  return {
    salon: mapSalon(salonRow),
    services: ((servicesData ?? []) as PublicServiceRow[]).map(mapService),
  };
}

export async function getPublicEmployeesForService(
  salonId: string,
  serviceId: string
): Promise<PublicEmployee[]> {
  const { data, error } = await supabase
    .from("employees")
    .select(
      `
        id,
        full_name,
        display_name,
        position,
        avatar_url,
        bio,
        sort_order,
        employee_services!inner(id)
      `
    )
    .eq("salon_id", salonId)
    .eq("is_active", true)
    .eq("is_bookable", true)
    .eq("is_public", true)
    .eq("employee_services.salon_id", salonId)
    .eq("employee_services.service_id", serviceId)
    .eq("employee_services.is_active", true)
    .order("sort_order", { ascending: true });

  if (error) {
    throw new Error("Failed to load public employees.", { cause: error });
  }

  return ((data ?? []) as PublicEmployeeRow[]).map((employee) => ({
    id: employee.id,
    name: employee.display_name || employee.full_name,
    position: employee.position,
    avatarUrl: employee.avatar_url,
    bio: employee.bio,
  }));
}

export async function getPublicAvailability(
  input: PublicAvailabilityInput,
  signal?: AbortSignal
): Promise<PublicAvailabilitySlot[]> {
  const response = await fetch("/api/public-booking/availability", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
    signal,
  });

  if (!response.ok) {
    throw new Error("Public availability request failed.");
  }

  const body: unknown = await response.json();

  if (
    !body ||
    typeof body !== "object" ||
    !("success" in body) ||
    body.success !== true ||
    !("slots" in body) ||
    !Array.isArray(body.slots) ||
    !body.slots.every(isPublicAvailabilitySlot)
  ) {
    throw new Error("Invalid public availability response.");
  }

  return body.slots;
}

export async function createPublicBooking(
  input: CreatePublicBookingInput
): Promise<CreatePublicBookingResult> {
  const response = await fetch("/api/public-booking/create", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  if (response.status === 409) {
    throw new PublicBookingConflictError();
  }

  if (!response.ok) {
    throw new Error("Public booking request failed.");
  }

  const body: unknown = await response.json();

  if (
    !body ||
    typeof body !== "object" ||
    !("success" in body) ||
    body.success !== true ||
    !("appointmentId" in body) ||
    typeof body.appointmentId !== "string"
  ) {
    throw new Error("Invalid public booking response.");
  }

  return { appointmentId: body.appointmentId };
}
