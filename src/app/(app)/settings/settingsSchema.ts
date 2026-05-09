import { z } from "zod";

export const settingsSchema = z.object({
  name: z
    .string()
    .min(2, "Salon name must be at least 2 characters long"),

  phone: z.string().nullable(),

  email: z
    .string()
    .email("Please enter a valid email")
    .or(z.literal(""))
    .nullable(),

  websiteUrl: z
    .string()
    .url("Please enter a valid URL")
    .or(z.literal(""))
    .nullable(),

  city: z.string().nullable(),

  addressLine: z.string().nullable(),
});

export type SettingsFormData = z.infer<typeof settingsSchema>;