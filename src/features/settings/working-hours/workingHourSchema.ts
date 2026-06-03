import { z } from "zod";

const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const workingHourSchema = z
  .object({
    day_of_week: z.coerce
      .number()
      .int()
      .min(0, "Dan mora biti između 0 i 6")
      .max(6, "Dan mora biti između 0 i 6"),

    opens_at: z
      .string()
      .regex(timeRegex, "Format otvaranja mora biti HH:mm"),

    closes_at: z
      .string()
      .regex(timeRegex, "Format zatvaranja mora biti HH:mm"),

    break_starts_at: z
      .string()
      .regex(timeRegex, "Format početka pauze mora biti HH:mm")
      .optional()
      .or(z.literal("")),

    break_ends_at: z
      .string()
      .regex(timeRegex, "Format kraja pauze mora biti HH:mm")
      .optional()
      .or(z.literal("")),

    is_working_day: z.boolean(),
  })
  .refine((data) => data.opens_at < data.closes_at, {
    message: "Vreme otvaranja mora biti pre vremena zatvaranja",
    path: ["closes_at"],
  })
  .refine(
    (data) => {
      if (!data.break_starts_at && !data.break_ends_at) return true;
      if (!data.break_starts_at || !data.break_ends_at) return false;

      return data.break_starts_at < data.break_ends_at;
    },
    {
      message: "Oba vremena pauze su obavezna i početak mora biti pre kraja",
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
      message: "Pauza mora biti unutar radnog vremena",
      path: ["break_starts_at"],
    }
  );

export type WorkingHourFormInput = z.input<typeof workingHourSchema>;
export type WorkingHourFormData = z.output<typeof workingHourSchema>;