import { z } from "zod";

export const generalSchema = z.object({
  name: z.string().min(2, "Naziv salona je obavezan"),
  email: z.string().email("Email nije validan").or(z.literal("")),
  phone: z.string().min(3, "Telefon je obavezan").or(z.literal("")),
  address_line: z.string().min(3, "Adresa je obavezna").or(z.literal("")),
  website_url: z.string().optional(),
  instagram_url: z.string().optional(),
  description: z.string().optional(),
});

export type GeneralFormData = z.infer<typeof generalSchema>;