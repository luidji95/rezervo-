import type { Metadata } from "next";
import { LandingPage } from "@/features/landing/LandingPage";
import "@/features/landing/landing.css";
import { getPublicPlanCatalog } from "@/features/pricing/services/publicPlanCatalog";

export const metadata: Metadata = {
  title: "Rezervo – online zakazivanje termina za salone | SMS podsetnici",
  description:
    "Online zakazivanje za frizerske, barber i beauty salone. Klijenti sami biraju termin, a vi šaljete SMS potvrdu i podsetnik. 3 meseca besplatno.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "Rezervo – online zakazivanje za salone",
    description: "Klijenti sami zakazuju termin, a vi šaljete SMS potvrdu i podsetnik. 3 meseca besplatno.",
    url: "/",
    siteName: "Rezervo",
    locale: "sr_RS",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Rezervo – online zakazivanje za salone",
    description: "Klijenti sami zakazuju termin, a vi šaljete SMS potvrdu i podsetnik.",
  },
};

export default async function HomePage() {
  return <LandingPage plans={await getPublicPlanCatalog()} />;
}
