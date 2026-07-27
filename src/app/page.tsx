import type { Metadata } from "next";
import { LandingPage } from "@/features/landing/LandingPage";
import "@/features/landing/landing.css";
import { getPublicPlanCatalog } from "@/features/pricing/services/publicPlanCatalog";

export const metadata: Metadata = {
  title: "Rezervo | Salon Management Software",
  description: "Modern SaaS platform for appointment scheduling, employees, CRM and salon management.",
  openGraph: {
    title: "Rezervo | Salon Management Software",
    description: "Modern SaaS platform for appointment scheduling, employees, CRM and salon management.",
    type: "website",
  },
};

export default async function HomePage() {
  return <LandingPage plans={await getPublicPlanCatalog()} />;
}
