import type { BooleanPlanCapability, PlanCode } from "../types/entitlements";

export type PlanFeaturePresentation = { label: string; availability: "included" | "not_included" | "coming_soon"; entitlementKey?: BooleanPlanCapability };
export type PlanPresentation = { code: PlanCode; name: string; description: string; features: PlanFeaturePresentation[]; comingSoon?: boolean };

export const PLAN_PRESENTATIONS: PlanPresentation[] = [
  { code: "starter", name: "Starter", description: "Core alati za manje salone i svakodnevno upravljanje poslovanjem.", features: [
    { label: "Kalendar, termini i public booking", availability: "included" }, { label: "Klijenti, usluge i radno vreme", availability: "included" }, { label: "Napredna statistika", availability: "not_included", entitlementKey: "canUseStatistics" }, { label: "AI receptionist", availability: "not_included" },
  ] },
  { code: "pro", name: "Pro", description: "Više prostora i uvida za salone sa timom koji raste.", features: [
    { label: "Sve iz Starter paketa", availability: "included" }, { label: "Napredna statistika", availability: "included", entitlementKey: "canUseStatistics" }, { label: "SMS/Viber podsetnici", availability: "coming_soon" }, { label: "Custom branding", availability: "coming_soon" }, { label: "AI receptionist", availability: "not_included" },
  ] },
  { code: "premium", name: "Premium / AI", description: "AI komunikacija i automatizacije za sledeću fazu Rezerva.", comingSoon: true, features: [
    { label: "Sve iz Pro paketa", availability: "included" }, { label: "AI receptionist i AI zakazivanje", availability: "coming_soon" }, { label: "WhatsApp i Instagram integracije", availability: "coming_soon" }, { label: "Human takeover i automatizacije", availability: "coming_soon" },
  ] },
];

export const PLAN_DESCRIPTIONS = Object.fromEntries(PLAN_PRESENTATIONS.map((plan) => [plan.code, plan.description])) as Record<PlanCode, string>;
