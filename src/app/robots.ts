import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/siteUrl";

// Google indeksira samo javni marketing (početna, paketi) i javne booking stranice salona.
// Aplikacija, prijava, onboarding, upravljanje rezervacijom i test rute ostaju van pretrage.
const PRIVATE_PATHS = [
  "/api/",
  "/auth/",
  "/onboarding",
  "/manage-booking",
  "/public/",
  "/dashboard",
  "/calendar",
  "/clients",
  "/employees",
  "/services",
  "/settings",
  "/statistics",
  "/working-hours",
  "/closures",
  "/appointmets",
  "/appointment-test",
  "/availability-test",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: PRIVATE_PATHS },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
