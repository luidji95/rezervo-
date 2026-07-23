import { supabase } from "@/lib/supabase/client";
import { validateAppointmentSlot } from "@/services/appointmentValidationService";
import { findOrCreateSalonClient } from "@/services/clientService";
import {
  createNotification,
  formatNotificationAppointmentTime,
} from "@/services/notificationService";
import { createTrustedAppointmentNotification } from "@/services/trustedAppointmentNotificationService";
import type {
  CreateAppointmentInput,
  CreateAppointmentResult,
} from "@/types/appointment";

type SupabaseClientLike = typeof supabase;

type CreatePublicBookingAtomicInput = {
  salonId: string;
  salonSlug: string;
  serviceId: string;
  employeeId: string;
  startTime: string;
  customer: {
    fullName: string;
    phone?: string;
    email?: string;
  };
  idempotencyKey: string;
};

type CreatePublicBookingAtomicResult = {
  id: string;
  wasCreated: boolean;
};

type PublicBookingRpcRow = {
  appointment_id: string;
  was_created: boolean;
  booked_service_name: string;
  appointment_start: string;
};

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

// =========================================================
// Create Action (Kreiranje novog termina)
// =========================================================
export async function createAppointment(
  input: CreateAppointmentInput,
  supabaseClient: SupabaseClientLike = supabase,
  options?: {
    enforceGeneratedSlot?: boolean;
  }
): Promise<CreateAppointmentResult> {
  const {
    salonId,
    serviceId,
    employeeId,
    startTime,
    client,
    customerNote,
    bookingSource = "manual",
  } = input;

  if (!salonId || !serviceId || !employeeId || !startTime) {
    throw new Error("Missing required appointment data.");
  }

  if (!client.fullName.trim()) {
    throw new Error("Client full name is required.");
  }

  const appointmentStart = new Date(startTime);

  if (Number.isNaN(appointmentStart.getTime())) {
    throw new Error("Invalid start time.");
  }

  const { data: service, error: serviceError } = await supabaseClient
    .from("services")
    .select(
      "id, salon_id, name, duration_minutes, buffer_minutes, price, currency, is_active"
    )
    .eq("id", serviceId)
    .eq("salon_id", salonId)
    .single();

  if (serviceError || !service) {
    throw new Error("Service not found.");
  }

  if (!service.is_active) {
    throw new Error("Service is not active.");
  }

  const { data: employeeService, error: employeeServiceError } =
    await supabaseClient
      .from("employee_services")
      .select("id, custom_duration_minutes, custom_price, is_active")
      .eq("salon_id", salonId)
      .eq("employee_id", employeeId)
      .eq("service_id", serviceId)
      .eq("is_active", true)
      .maybeSingle();

  if (employeeServiceError) {
    throw new Error("Failed to check employee/service compatibility.");
  }

  if (!employeeService) {
    throw new Error("This employee does not provide the selected service.");
  }

  const durationMinutes =
    employeeService.custom_duration_minutes ?? service.duration_minutes;

  const price = employeeService.custom_price ?? service.price;
  const bufferMinutes = service.buffer_minutes ?? 0;

  const appointmentEnd = addMinutes(
    appointmentStart,
    durationMinutes + bufferMinutes
  );

  const startIso = appointmentStart.toISOString();
  const endIso = appointmentEnd.toISOString();

  await validateAppointmentSlot(
    {
      salonId,
      employeeId,
      serviceId,
      startTime: startIso,
      endTime: endIso,
      enforceGeneratedSlot: options?.enforceGeneratedSlot ?? false,
    },
    supabaseClient
  );

  const clientId = await findOrCreateSalonClient(
    {
      salonId,
      fullName: client.fullName,
      phone: client.phone,
      email: client.email,
      source: bookingSource,
    },
    supabaseClient
  );

  const { data: appointment, error: appointmentError } = await supabaseClient
    .from("appointments")
    .insert({
      salon_id: salonId,
      client_id: clientId,
      employee_id: employeeId,
      primary_service_id: serviceId,
      start_time: startIso,
      end_time: endIso,
      duration_minutes: durationMinutes,
      buffer_minutes: bufferMinutes,
      price,
      currency: service.currency,
      status: "pending",
      payment_status: "unpaid",
      booking_source: bookingSource,
      customer_note: customerNote?.trim() || null,
    })
    .select("*")
    .single();

  if (appointmentError || !appointment) {
    throw new Error("Failed to create appointment.");
  }

  const { error: snapshotError } = await supabaseClient
    .from("appointment_services")
    .insert({
      appointment_id: appointment.id,
      service_id: serviceId,
      service_name_snapshot: service.name,
      duration_minutes_snapshot: durationMinutes,
      price_snapshot: price,
      sort_order: 0,
    });

  if (snapshotError) {
    throw new Error("Appointment created, but service snapshot failed.");
  }

  if (process.env.NODE_ENV === "development") {
    console.debug("OWNER_STATUS_NOTIFICATION_SOURCE", {
      source: "appointmentService/createAppointment",
      appointmentId: appointment.id,
      eventType: "appointment_created",
    });
  }
  await createTrustedAppointmentNotification(
    appointment.id,
    "appointment_created",
  ).catch(() => null);

  return appointment;
}

// =========================================================
// Reschedule Akcija (Pomeranje termina)
// =========================================================
export async function rescheduleAppointment(
  appointmentId: string,
  newStart: string,
  newEnd: string,
  newEmployeeId: string,
  supabaseClient: SupabaseClientLike = supabase // Dodata opcija za prosleđivanje klijenta radi konzistentnosti
) {
  const updateData = {
    start_time: newStart,
    end_time: newEnd,
    employee_id: newEmployeeId,
    status: "confirmed"
  };

  const { data, error } = await supabaseClient
    .from("appointments")
    .update(updateData)
    .eq("id", appointmentId)
    .select(`
      id,
      salon_id,
      start_time,
      clients (full_name),
      services:primary_service_id (name)
    `)
    .single();

  if (error) {
    throw new Error(error.message);
  }

  const appointment = data as unknown as {
    id: string;
    salon_id: string;
    start_time: string;
    clients: { full_name: string } | null;
    services: { name: string } | null;
  };

  if (process.env.NODE_ENV === "development") {
    console.debug("OWNER_STATUS_NOTIFICATION_SOURCE", {
      source: "appointmentService/rescheduleAppointment",
      appointmentId: appointment.id,
      eventType: "appointment_rescheduled",
    });
  }
  await createTrustedAppointmentNotification(
    appointment.id,
    "appointment_rescheduled",
  ).catch(() => null);

  return appointment;
}

export async function createPublicBookingAtomic(
  input: CreatePublicBookingAtomicInput,
  supabaseClient: SupabaseClientLike = supabase
): Promise<CreatePublicBookingAtomicResult> {
  const { data, error } = await supabaseClient.rpc(
    "create_public_booking_atomic",
    {
      p_salon_slug: input.salonSlug,
      p_service_id: input.serviceId,
      p_employee_id: input.employeeId,
      p_start_time: input.startTime,
      p_customer_full_name: input.customer.fullName,
      p_customer_phone: input.customer.phone || "",
      p_customer_email: input.customer.email || "",
      p_idempotency_key: input.idempotencyKey,
    }
  );

  if (error) {
    throw error;
  }

  const result = (data as PublicBookingRpcRow[] | null)?.[0];

  if (!result) {
    throw new Error("Public booking RPC returned no result.");
  }

  if (result.was_created) {
    const notification = await createNotification(
      {
        salonId: input.salonId,
        type: "appointment_created",
        title: "Novi termin",
        message: `${input.customer.fullName.trim()} je rezervisao/la ${result.booked_service_name} za ${formatNotificationAppointmentTime(result.appointment_start)}`,
        entityType: "appointment",
        entityId: result.appointment_id,
      },
      supabaseClient
    );

    if (!notification && process.env.NODE_ENV === "development") {
      console.error("PUBLIC_APPOINTMENT_NOTIFICATION_MISSING", {
        appointmentCreated: true,
        notificationInsertAttempted: true,
        appointmentIdPresent: Boolean(result.appointment_id),
      });
    }
  }

  return {
    id: result.appointment_id,
    wasCreated: result.was_created,
  };
}

// =========================================================
// Update Details Akcija (Izmena tekstualnih podataka)
// =========================================================
export async function updateAppointmentDetails(
  appointmentId: string,
  clientId: string,
  data: {
    fullName: string;
    phone: string;
    email: string;
    internalNote: string;
    customerNote: string;
  },
  supabaseClient: SupabaseClientLike = supabase // SADA KORISTI KONZISTENTAN KLIJENT
) {
  // 1. Ažuriramo klijenta (trimujemo ulaze odmah radi čiste baze)
  const { error: clientError } = await supabaseClient
    .from("clients")
    .update({
      full_name: data.fullName.trim(),
      phone: data.phone?.trim() || null,
      email: data.email?.trim() || null,
    })
    .eq("id", clientId);

  if (clientError) {
    throw new Error(`Greška pri ažuriranju klijenta: ${clientError.message}`);
  }

  // 2. Ažuriramo termin (napomene)
  const { error: appointmentError } = await supabaseClient
    .from("appointments")
    .update({
      internal_note: data.internalNote?.trim() || null,
      customer_note: data.customerNote?.trim() || null,
    })
    .eq("id", appointmentId);

  if (appointmentError) {
    throw new Error(`Greška pri ažuriranju napomena termina: ${appointmentError.message}`);
  }

  return { success: true };
}
