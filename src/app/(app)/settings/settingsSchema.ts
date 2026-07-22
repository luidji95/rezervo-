import { z } from "zod";
import { optionalEmailSchema, optionalPhoneSchema, optionalUrlSchema, requiredStringSchema } from "@/lib/validation/commonSchemas";

export const settingsSchema = z.object({
  name: requiredStringSchema("Naziv salona", 2, 120),

  phone: optionalPhoneSchema.nullable(),

  email: optionalEmailSchema.nullable(),

  websiteUrl: optionalUrlSchema.nullable(),

  city: z.string().trim().max(120, "Naziv grada je predugačak").nullable(),

  addressLine: z.string().trim().max(200, "Adresa je predugačka").nullable(),
});

export type SettingsFormData = z.infer<typeof settingsSchema>;
