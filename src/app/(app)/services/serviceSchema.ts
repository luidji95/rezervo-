import { z } from "zod";

export const servicesSchema = z.object({
  name: z.string().trim().min(2, "Naziv usluge je obavezan").max(120, "Naziv usluge je predugačak"),

  description: z.string().trim().max(1000, "Opis je predugačak").optional(),

  categoryName: z.string().trim().max(120, "Naziv kategorije je predugačak").optional(),

  durationMinutes: z.coerce
    .number()
    .int("Trajanje mora biti ceo broj minuta")
    .min(5, "Trajanje mora biti najmanje 5 minuta")
    .max(1440, "Trajanje ne može biti duže od 24 sata"),

  priceAmount: z.coerce
    .number()
    .finite("Cena mora biti ispravan broj")
    .min(0, "Cena ne može biti negativna")
    .max(1000000, "Cena je previsoka"),

  isActive: z.boolean().optional(),

  isPublic: z.boolean().optional(),
});

export type ServicesFormInput = z.input<typeof servicesSchema>;
export type ServicesFormData = z.output<typeof servicesSchema>;
