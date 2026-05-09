import { z } from "zod";

export const servicesSchema = z.object({
  name: z.string().min(2, "Service name is required"),

  description: z.string().optional(),

  durationMinutes: z.coerce
    .number()
    .min(5, "Duration must be at least 5 minutes"),

  priceAmount: z.coerce
    .number()
    .min(0, "Price cannot be negative"),
});

export type ServicesFormInput = z.input<typeof servicesSchema>;
export type ServicesFormData = z.output<typeof servicesSchema>;