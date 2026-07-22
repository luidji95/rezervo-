export type BookingSource =
  | "manual"
  | "public"
  | "ai"
  | "whatsapp"
  | "instagram";

export type CreateAppointmentInput = {
  salonId: string;
  serviceId: string;
  employeeId: string;
  startTime: string;

  client: {
    fullName: string;
    phone?: string;
    email?: string;
  };

  customerNote?: string;
  bookingSource?: BookingSource;
};

export type CreateAppointmentResult = {
  id: string;
  salon_id: string;
  client_id: string;
  employee_id: string | null;
  primary_service_id: string | null;
  start_time: string;
  end_time: string;
  duration_minutes: number;
  buffer_minutes: number;
  price: number;
  currency: string;
  status: string;
};

import { z } from "zod";
import { optionalEmailSchema, optionalPhoneSchema, optionalTrimmedStringSchema, requiredStringSchema } from "@/lib/validation/commonSchemas";

export const appointmentClientSchema = z.object({
  fullName: requiredStringSchema("Ime i prezime klijenta", 2, 120),
  phone: optionalPhoneSchema,
  email: optionalEmailSchema,
});

// Šema za validaciju forme novog termina
export const createAppointmentSchema = z.object({
  salonId: z.string().uuid("Nevažeći ID salona"),
  serviceId: z.string().uuid("Izbor usluge je obavezan"),
  employeeId: z.string().uuid("Izbor zaposlenog je obavezan"),
  startTime: z.string().min(1, "Vreme početka je obavezno"), // ISO string kombinacija datuma i vremena
  bookingSource: z.enum([
  "manual",
  "public",
  "ai",
  "whatsapp",
  "instagram",
]),
  customerNote: optionalTrimmedStringSchema(1000),
  
  // Ugniježdeni objekat za klijenta
  client: appointmentClientSchema,
});

// Izvedeni TypeScript tip na osnovu Zod šeme
export type CreateAppointmentFormInput = z.infer<typeof createAppointmentSchema>;
