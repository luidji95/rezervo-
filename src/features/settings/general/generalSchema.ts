import { z } from "zod";
import { optionalEmailSchema, optionalInstagramSchema, optionalPhoneSchema, optionalTrimmedStringSchema, optionalUrlSchema, requiredStringSchema } from "@/lib/validation/commonSchemas";

export const generalSchema = z.object({
  name: requiredStringSchema("Naziv salona", 2, 120),
  email: optionalEmailSchema,
  phone: optionalPhoneSchema,
  address_line: z.union([requiredStringSchema("Adresa", 3, 200), z.literal("")]),
  website_url: optionalUrlSchema,
  instagram_url: optionalInstagramSchema,
  description: optionalTrimmedStringSchema(1000),
});

export type GeneralFormData = z.infer<typeof generalSchema>;
