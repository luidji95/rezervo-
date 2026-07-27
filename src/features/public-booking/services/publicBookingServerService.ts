import "server-only";

import { supabaseServer } from "@/lib/supabaseServer";
import type { PublicSalon, PublicSalonPageData, PublicService } from "../types";
import { hasPublicBookingAccess } from "./publicBookingAccessService";

type SalonRow = {
  id: string; name: string; slug: string; logo_url: string | null;
  cover_image_url: string | null; description: string | null;
  short_description: string | null; address_line: string | null;
  city: string | null; phone: string | null; email: string | null;
  website_url: string | null; instagram_url: string | null;
  timezone: string | null; status: string; booking_enabled: boolean;
  online_booking_enabled: boolean;
};
type ServiceRow = { id: string; name: string; description: string | null; duration_minutes: number; price: number | string; currency: string | null };

const SALON_FIELDS = "id,name,slug,logo_url,cover_image_url,description,short_description,address_line,city,phone,email,website_url,instagram_url,timezone,status,booking_enabled,online_booking_enabled";

export async function getPublicSalonPageData(slug: string): Promise<PublicSalonPageData | null> {
  const normalizedSlug = slug.trim();
  if (!normalizedSlug) return null;

  const { data, error } = await supabaseServer.from("salons").select(SALON_FIELDS)
    .eq("slug", normalizedSlug).maybeSingle();
  if (error) throw new Error("Failed to load public salon.", { cause: error });
  if (!data) return null;
  const row = data as SalonRow;
  const flagsAllowBooking = row.status === "active" && row.booking_enabled && row.online_booking_enabled;
  const bookingAvailable = flagsAllowBooking && await hasPublicBookingAccess(row.id);

  let services: PublicService[] = [];
  if (bookingAvailable) {
    const result = await supabaseServer.from("services")
      .select("id,name,description,duration_minutes,price,currency")
      .eq("salon_id", row.id).eq("is_active", true).eq("is_public", true)
      .order("sort_order", { ascending: true });
    if (result.error) throw new Error("Failed to load public services.", { cause: result.error });
    services = ((result.data ?? []) as ServiceRow[]).map((service) => ({
      id: service.id, name: service.name, description: service.description,
      durationMinutes: service.duration_minutes, price: Number(service.price),
      currency: service.currency || "RSD",
    }));
  }

  const salon: PublicSalon = {
    id: row.id, name: row.name, slug: row.slug, logoUrl: row.logo_url,
    coverImageUrl: row.cover_image_url, description: row.description,
    shortDescription: row.short_description, addressLine: row.address_line,
    city: row.city, phone: row.phone, email: row.email,
    websiteUrl: row.website_url, instagramUrl: row.instagram_url,
    timezone: row.timezone || "Europe/Belgrade",
  };
  return { salon, services, bookingAvailable };
}
