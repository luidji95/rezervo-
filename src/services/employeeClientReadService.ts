import { supabase } from "@/lib/supabase/client";

export type EmployeeAppointmentClient = {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
};

export async function getEmployeeAppointmentClients(
  salonId: string,
): Promise<EmployeeAppointmentClient[]> {
  const { data, error } = await supabase.rpc(
    "get_employee_appointment_clients",
    { target_salon_id: salonId },
  );

  if (error) throw new Error(error.message);
  return (data ?? []) as EmployeeAppointmentClient[];
}
