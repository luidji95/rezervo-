import { z } from "zod";

const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const workingHourSchema = z
  .object({
    day_of_week: z.coerce
      .number()
      .int()
      .min(0, "Day must be between 0 and 6")
      .max(6, "Day must be between 0 and 6"),

    opens_at: z
      .string()
      .regex(timeRegex, "Opening time must be in HH:mm format"),

    closes_at: z
      .string()
      .regex(timeRegex, "Closing time must be in HH:mm format"),

    break_starts_at: z
      .string()
      .regex(timeRegex, "Break start must be in HH:mm format")
      .optional()
      .or(z.literal("")),

    break_ends_at: z
      .string()
      .regex(timeRegex, "Break end must be in HH:mm format")
      .optional()
      .or(z.literal("")),

    is_working_day: z.boolean(),
  })
  .refine((data) => data.opens_at < data.closes_at, {
    message: "Opening time must be before closing time",
    path: ["closes_at"],
  })
  .refine(
    (data) => {
      if (!data.break_starts_at && !data.break_ends_at) return true;
      if (!data.break_starts_at || !data.break_ends_at) return false;

      return data.break_starts_at < data.break_ends_at;
    },
    {
      message: "Both break times are required and break start must be before break end",
      path: ["break_ends_at"],
    }
  )
  .refine(
    (data) => {
      if (!data.break_starts_at || !data.break_ends_at) return true;

      return (
        data.break_starts_at >= data.opens_at &&
        data.break_ends_at <= data.closes_at
      );
    },
    {
      message: "Break must be inside working hours",
      path: ["break_starts_at"],
    }
  );

export type WorkingHourFormInput = z.input<typeof workingHourSchema>;
export type WorkingHourFormData = z.output<typeof workingHourSchema>;