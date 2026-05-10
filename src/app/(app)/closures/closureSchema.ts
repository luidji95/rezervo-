import { z } from "zod";

export const closureSchema = z
  .object({
    employee_id: z.string().optional(),

    title: z
      .string()
      .min(2, "Title must contain at least 2 characters")
      .max(100, "Title is too long"),

    reason: z
      .string()
      .max(500, "Reason is too long")
      .optional(),

    starts_at: z.string().min(1, "Start date is required"),

    ends_at: z.string().min(1, "End date is required"),

    is_full_day: z.boolean(),
  })
  .refine(
    (data) => {
      return new Date(data.starts_at) < new Date(data.ends_at);
    },
    {
      message: "End date must be after start date",
      path: ["ends_at"],
    }
  );

export type ClosureFormInput = z.input<typeof closureSchema>;
export type ClosureFormData = z.output<typeof closureSchema>;