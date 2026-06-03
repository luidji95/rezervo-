import { z } from "zod";

export const closureSchema = z
  .object({
    title: z
      .string()
      .min(2, "Naziv praznika ili odmora mora imati bar 2 karaktera")
      .max(100, "Naziv je predugačak"),
    
    starts_at: z
      .string()
      .min(1, "Datum početka je obavezan"),
    
    ends_at: z
      .string()
      .min(1, "Datum kraja je obavezan"),
  })
  .refine((data) => data.starts_at <= data.ends_at, {
    message: "Datum završetka ne može biti pre datuma početka",
    path: ["ends_at"],
  });

export type ClosureFormInput = z.input<typeof closureSchema>;
export type ClosureFormData = z.output<typeof closureSchema>;