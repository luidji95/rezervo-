import { z } from "zod";
import { emailSchema, optionalInstagramSchema, optionalUrlSchema, phoneSchema, requiredStringSchema } from "@/lib/validation/commonSchemas";

export const SALON_BUSINESS_TYPE_OPTIONS = [
  { label: "Barber", value: "barbershop" },
  { label: "Frizerski salon", value: "hair_salon" },
  { label: "Kozmetički salon", value: "beauty_salon" },
  { label: "Nokti", value: "beauty_salon" },
  { label: "Spa", value: "spa" },
  { label: "Ostalo", value: "other" },
] as const;

export const SALON_BUSINESS_TYPE_VALUES = [
  "barbershop",
  "hair_salon",
  "beauty_salon",
  "spa",
  "other",
] as const;

export const onboardingSchema = z.object({
  name: requiredStringSchema("Naziv salona", 1, 120),
  businessType: z.enum(SALON_BUSINESS_TYPE_VALUES, {
    error: "Business type is required.",
  }),
  phone: phoneSchema,
  email: emailSchema,
  addressLine: requiredStringSchema("Adresa", 1, 200),
  websiteUrl: optionalUrlSchema,
  instagramUrl: optionalInstagramSchema,
  description: z.string().trim().max(1000, "Opis je predugačak."),
});

export type OnboardingFormData = z.infer<typeof onboardingSchema>;
