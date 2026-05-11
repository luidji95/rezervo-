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