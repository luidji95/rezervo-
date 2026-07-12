import type { OnboardingServiceTemplateItem } from "../types/onboarding";

export const SERVICE_TEMPLATES: Record<
  string,
  OnboardingServiceTemplateItem[]
> = {
  barbershop: [
    { name: "Muško šišanje", durationMinutes: 30, priceAmount: 1200 },
    { name: "Brada", durationMinutes: 20, priceAmount: 700 },
    { name: "Šišanje + brada", durationMinutes: 45, priceAmount: 1700 },
  ],
  hair_salon: [
    { name: "Šišanje", durationMinutes: 45, priceAmount: 1500 },
    { name: "Feniranje", durationMinutes: 30, priceAmount: 1200 },
    { name: "Farbanje", durationMinutes: 90, priceAmount: 3500 },
  ],
  beauty_salon: [
    { name: "Tretman lica", durationMinutes: 60, priceAmount: 3000 },
    { name: "Depilacija", durationMinutes: 30, priceAmount: 1500 },
    { name: "Masaža", durationMinutes: 60, priceAmount: 3500 },
  ],
  spa: [
    { name: "Masaža", durationMinutes: 60, priceAmount: 4000 },
    { name: "Relax tretman", durationMinutes: 90, priceAmount: 6000 },
  ],
  other: [{ name: "Usluga", durationMinutes: 30, priceAmount: 1000 }],
};

