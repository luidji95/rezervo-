export type EmployeeService = {
  id: string;
  salon_id: string;
  employee_id: string;
  service_id: string;
  custom_duration_minutes: number | null;
  custom_price: number | null;
  is_active: boolean;
  created_at: string;
};

export type AssignServiceToEmployeeInput = {
  salonId: string;
  employeeId: string;
  serviceId: string;
  customDurationMinutes?: number | null;
  customPrice?: number | null;
};

export type RemoveServiceFromEmployeeInput = {
  employeeId: string;
  serviceId: string;
};