import { z } from "zod";

export const employeeSchema = z.object({
  fullName: z.string().min(2, "Full name is required"),

  displayName: z.string().optional(),

  position: z.string().optional(),

  phone: z.string().optional(),

  email: z
    .string()
    .email("Invalid email address")
    .optional()
    .or(z.literal("")),

  bio: z.string().optional(),
});

export type EmployeeFormInput = z.input<typeof employeeSchema>;
export type EmployeeFormData = z.output<typeof employeeSchema>;