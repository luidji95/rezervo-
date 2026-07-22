import { z } from "zod";
import { optionalEmailSchema, optionalPhoneSchema, optionalTrimmedStringSchema, requiredStringSchema } from "@/lib/validation/commonSchemas";

export const employeeSchema = z.object({
  fullName: requiredStringSchema("Ime i prezime", 2, 120),

  displayName: optionalTrimmedStringSchema(120),

  position: optionalTrimmedStringSchema(120),

  phone: optionalPhoneSchema,

  email: optionalEmailSchema,

  bio: optionalTrimmedStringSchema(1000),
  isActive: z.boolean().default(true),
  isBookable: z.boolean().default(true),
  isPublic: z.boolean().default(true),
});

export type EmployeeFormInput = z.input<typeof employeeSchema>;
export type EmployeeFormData = z.output<typeof employeeSchema>;
