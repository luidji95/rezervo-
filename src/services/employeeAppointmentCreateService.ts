import { supabase } from "@/lib/supabase/client";
import type { AvailableSlot } from "@/types/availability";

export type EmployeeCreateServiceOption = {
  id: string;
  name: string;
  durationMinutes: number;
  price: number;
  currency: string;
};

export type EmployeeCreateAppointmentInput = {
  serviceId: string;
  startTime: string;
  customer: { fullName: string; phone?: string; email?: string };
  note?: string;
  idempotencyKey: string;
};

export class EmployeeCreateAppointmentError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "EmployeeCreateAppointmentError";
  }
}

async function authenticatedFetch(input: RequestInfo | URL, init?: RequestInit) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new EmployeeCreateAppointmentError("UNAUTHORIZED");

  return fetch(input, {
    ...init,
    headers: {
      ...init?.headers,
      Authorization: `Bearer ${session.access_token}`,
    },
  });
}

async function parseResponse<T>(response: Response): Promise<T> {
  const result = (await response.json().catch(() => null)) as
    | ({ success: true } & T)
    | { success: false; code?: string }
    | null;
  if (!response.ok || !result?.success) {
    throw new EmployeeCreateAppointmentError(
      result && "code" in result && result.code ? result.code : "CREATE_FAILED",
    );
  }
  return result;
}

export async function getEmployeeCreateServices() {
  const response = await authenticatedFetch("/api/employee/appointments", {
    cache: "no-store",
  });
  const result = await parseResponse<{ services: EmployeeCreateServiceOption[] }>(response);
  return result.services;
}

export async function getEmployeeAvailableSlots(serviceId: string, date: string) {
  const response = await authenticatedFetch("/api/employee/appointments/availability", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ serviceId, date }),
  });
  const result = await parseResponse<{ slots: AvailableSlot[] }>(response);
  return result.slots;
}

export async function createOwnAppointment(input: EmployeeCreateAppointmentInput) {
  const response = await authenticatedFetch("/api/employee/appointments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseResponse<{
    appointment: { id: string; status: string; startTime: string };
  }>(response);
}
