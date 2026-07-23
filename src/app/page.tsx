import type { Metadata } from "next";
import { LandingPage } from "@/features/landing/LandingPage";
import "@/features/landing/landing.css";

export const metadata: Metadata = {
  title: "Rezervo | Salon Management Software",
  description: "Modern SaaS platform for appointment scheduling, employees, CRM and salon management.",
  openGraph: {
    title: "Rezervo | Salon Management Software",
    description: "Modern SaaS platform for appointment scheduling, employees, CRM and salon management.",
    type: "website",
  },
};

export default function HomePage() {
  return <LandingPage />;
}
