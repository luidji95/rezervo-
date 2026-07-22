import { z } from "zod";
import { optionalEmailSchema, optionalPhoneSchema, requiredStringSchema } from "@/lib/validation/commonSchemas";

export const clientSchema = z.object({
  fullName: requiredStringSchema("Ime i prezime", 2, 120),
  phone: optionalPhoneSchema,
  email: optionalEmailSchema,
  source: z.enum(["manual", "instagram", "public", "whatsapp", "referral"]),
});
