import type { BooleanPlanCapability, PlanCode } from "../types/entitlements";

export type PlanFeaturePresentation = { label: string; availability: "included" | "not_included" | "coming_soon"; entitlementKey?: BooleanPlanCapability };
export type PlanPresentation = { code: PlanCode; name: string; description: string; features: PlanFeaturePresentation[]; comingSoon?: boolean };

export const PLAN_PRESENTATIONS: PlanPresentation[] = [
  { code: "starter", name: "Starter", description: "Osnovni alati za manje salone i svakodnevno upravljanje poslovanjem.", features: [
    { label: "Termini i online booking", availability: "included" }, { label: "Klijenti, zaposleni i usluge", availability: "included" }, { label: "Napredna statistika", availability: "not_included", entitlementKey: "canUseStatistics" }, { label: "SMS podsetnici", availability: "not_included", entitlementKey: "canUseSmsReminders" },
  ] },
  { code: "pro", name: "Pro", description: "Više prostora i uvida za salone sa timom koji raste.", features: [
    { label: "Sve iz Starter paketa", availability: "included" }, { label: "Napredna statistika", availability: "included", entitlementKey: "canUseStatistics" }, { label: "SMS podsetnici", availability: "included", entitlementKey: "canUseSmsReminders" }, { label: "AI receptionist", availability: "not_included" },
  ] },
  { code: "premium", name: "Premium", description: "Planirane AI komunikacije i automatizacije za sledeću fazu Rezerva.", comingSoon: true, features: [
    { label: "Statistika i SMS podsetnici", availability: "included" }, { label: "AI receptionist i AI zakazivanje", availability: "coming_soon" }, { label: "WhatsApp i Instagram integracije", availability: "coming_soon" }, { label: "Marketing funkcije", availability: "coming_soon" },
  ] },
];

export const PLAN_DESCRIPTIONS = Object.fromEntries(PLAN_PRESENTATIONS.map((plan) => [plan.code, plan.description])) as Record<PlanCode, string>;
