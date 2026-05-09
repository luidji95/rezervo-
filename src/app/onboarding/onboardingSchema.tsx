import { z } from "zod";

export const onboardingSchema = z.object({
  salonName: z.string().min(2, "Salon name is required"),
  phone: z.string().min(6, "Phone number is required"),
  city: z.string().min(2, "City is required"),
  address: z.string().min(3, "Address is required"),
});

export type OnboardingFormData = z.infer<typeof onboardingSchema>;