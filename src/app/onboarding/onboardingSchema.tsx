import { z } from "zod";

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

const optionalUrl = z
  .string()
  .trim()
  .refine((value) => value === "" || URL.canParse(value), {
    message: "Enter a valid URL.",
  });

const optionalInstagram = z
  .string()
  .trim()
  .refine(
    (value) =>
      value === "" ||
      URL.canParse(value) ||
      /^@?[a-zA-Z0-9._]{1,30}$/.test(value),
    {
      message: "Enter an Instagram username or URL.",
    }
  );

export const onboardingSchema = z.object({
  name: z.string().trim().min(1, "Salon name is required."),
  businessType: z.enum(SALON_BUSINESS_TYPE_VALUES, {
    error: "Business type is required.",
  }),
  phone: z.string().trim(),
  email: z.union([
    z.string().trim().email("Enter a valid email."),
    z.literal(""),
  ]),
  addressLine: z.string().trim(),
  websiteUrl: optionalUrl,
  instagramUrl: optionalInstagram,
  description: z.string().trim(),
});

export type OnboardingFormData = z.infer<typeof onboardingSchema>;
