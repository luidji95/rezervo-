import { z } from "zod";
import { emailSchema } from "@/lib/validation/commonSchemas";

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Lozinka je obavezna."),
});

export const registerSchema = z
  .object({
    email: emailSchema,
    password: z
      .string()
      .min(8, "Lozinka mora imati najmanje 8 karaktera."),
    confirmPassword: z.string().min(1, "Potvrdite lozinku."),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: "Lozinke se ne podudaraju.",
    path: ["confirmPassword"],
  });

export type LoginFormValues = z.infer<typeof loginSchema>;
export type RegisterFormValues = z.infer<typeof registerSchema>;

export const acceptInvitePasswordSchema = z
  .object({
    password: z
      .string()
      .min(8, "Lozinka mora imati najmanje 8 karaktera."),
    confirmPassword: z.string().min(1, "Potvrdite lozinku."),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: "Lozinke se ne podudaraju.",
    path: ["confirmPassword"],
  });

export type AcceptInvitePasswordValues = z.infer<
  typeof acceptInvitePasswordSchema
>;
