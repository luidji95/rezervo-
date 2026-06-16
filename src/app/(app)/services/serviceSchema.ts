import { z } from "zod";

export const servicesSchema = z.object({
  name: z.string().trim().min(2, "Naziv usluge je obavezan"),

  description: z.string().trim().optional(),

  categoryName: z.string().trim().optional(),

  durationMinutes: z.coerce
    .number()
    .min(5, "Trajanje mora biti najmanje 5 minuta"),

  priceAmount: z.coerce
    .number()
    .min(0, "Cena ne može biti negativna"),

  isActive: z.boolean().optional(),

  isPublic: z.boolean().optional(),
});

export type ServicesFormInput = z.input<typeof servicesSchema>;
export type ServicesFormData = z.output<typeof servicesSchema>;
