import type { PreviewPayment, PreviewPlan } from "../types";

export const currentPlanPreview = {
  name: "Pro Plan",
  price: "2.990 RSD",
  description:
    "Napredni alati za salone koji žele više automatizacije i prostora za rast.",
  features: [
    "Do 5 zaposlenih",
    "Online rezervacije",
    "AI receptionist preview",
    "Napredne integracije",
  ],
};

export const previewPlans: PreviewPlan[] = [
  {
    id: "basic",
    name: "Basic",
    monthlyPrice: "1.490 RSD",
    yearlyPrice: "14.300 RSD",
    description: "Osnovni alati za manje salone i samostalne profesionalce.",
    features: ["Do 2 zaposlena", "Online rezervacije", "Osnovna analitika"],
  },
  {
    id: "pro",
    name: "Pro",
    monthlyPrice: "2.990 RSD",
    yearlyPrice: "28.700 RSD",
    description: "Više automatizacije za timove koji rastu.",
    features: [
      "Do 5 zaposlenih",
      "AI receptionist",
      "Napredne integracije",
      "Više automatizacija",
    ],
    popular: true,
    current: true,
  },
  {
    id: "premium",
    name: "Premium",
    monthlyPrice: "5.990 RSD",
    yearlyPrice: "57.500 RSD",
    description: "Kompletan paket za velike salone i više lokacija.",
    features: [
      "Neograničeni zaposleni",
      "Napredna analitika",
      "Prioritetna podrška",
      "Custom branding",
      "API pristup",
    ],
  },
];

export const paymentHistoryPreview: PreviewPayment[] = [
  { id: "preview-1", date: "12.05.2026", plan: "Pro Plan", amount: "2.990 RSD", status: "Uspešno" },
  { id: "preview-2", date: "12.04.2026", plan: "Pro Plan", amount: "2.990 RSD", status: "Uspešno" },
  { id: "preview-3", date: "12.03.2026", plan: "Pro Plan", amount: "2.990 RSD", status: "Uspešno" },
];
