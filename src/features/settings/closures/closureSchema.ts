import { z } from "zod";

export const closureSchema = z
  .object({
    employee_id: z.string().optional().or(z.literal("")),
    title: z.string().min(2, "Naziv je obavezan"),
    reason: z.string().optional().or(z.literal("")),
    starts_at: z.string().min(1, "Početak je obavezan"),
    ends_at: z.string().min(1, "Kraj je obavezan"),
    is_full_day: z.boolean(),
  })
  .refine(
    (data) => {
      const start = new Date(data.starts_at);
      const end = new Date(data.ends_at);

      return end >= start;
    },
    {
      message: "Kraj mora biti posle početka",
      path: ["ends_at"],
    }
  );

export type ClosureFormInput = z.input<typeof closureSchema>;
export type ClosureFormData = z.output<typeof closureSchema>;