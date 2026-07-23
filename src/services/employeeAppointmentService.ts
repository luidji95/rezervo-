import { supabase } from "@/lib/supabase/client";

export type EmployeeAppointmentStatus =
  | "confirmed"
  | "completed"
  | "cancelled"
  | "no_show";

export type EmployeeAppointmentErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "INVALID_INPUT"
  | "APPOINTMENT_NOT_FOUND"
  | "INVALID_STATUS_TRANSITION"
  | "APPOINTMENT_ALREADY_UPDATED"
  | "UPDATE_FAILED";

export class EmployeeAppointmentError extends Error {
  constructor(public readonly code: EmployeeAppointmentErrorCode) {
    super(code);
    this.name = "EmployeeAppointmentError";
  }
}

export async function updateOwnAppointmentStatus(
  appointmentId: string,
  status: EmployeeAppointmentStatus,
) {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    throw new EmployeeAppointmentError("UNAUTHORIZED");
  }

  const response = await fetch(
    `/api/employee/appointments/${encodeURIComponent(appointmentId)}/status`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status }),
    },
  );
  const result = (await response.json().catch(() => null)) as
    | { success: true; appointment: { id: string; status: string } }
    | { success: false; code?: EmployeeAppointmentErrorCode }
    | null;

  if (!response.ok || !result?.success) {
    throw new EmployeeAppointmentError(
      result && "code" in result && result.code
        ? result.code
        : "UPDATE_FAILED",
    );
  }

  return result.appointment;
}
