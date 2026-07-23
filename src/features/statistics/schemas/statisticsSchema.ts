import { z } from "zod";

export const statisticsPresetSchema = z.enum([
  "today",
  "last_7_days",
  "this_month",
  "previous_month",
  "last_3_months",
  "this_year",
  "custom",
]);

const dateKeySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Datum mora biti u YYYY-MM-DD formatu.")
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    );
  }, "Datum nije validan.");

export const statisticsPeriodInputSchema = z
  .object({
    preset: statisticsPresetSchema,
    customStart: dateKeySchema.optional(),
    customEnd: dateKeySchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.preset !== "custom") return;
    if (!value.customStart) {
      context.addIssue({ code: "custom", path: ["customStart"], message: "Početni datum je obavezan." });
    }
    if (!value.customEnd) {
      context.addIssue({ code: "custom", path: ["customEnd"], message: "Krajnji datum je obavezan." });
    }
    if (value.customStart && value.customEnd && value.customStart > value.customEnd) {
      context.addIssue({ code: "custom", path: ["customEnd"], message: "Krajnji datum mora biti posle početnog." });
    }
  });

export const statisticsQuerySchema = z.object({
  salonId: z.string().uuid(),
  preset: statisticsPresetSchema.default("this_month"),
  start: dateKeySchema.optional(),
  end: dateKeySchema.optional(),
});
