import { supabase } from "@/lib/supabase/client";
import type {
  CreateAppointmentInput,
  CreateAppointmentResult,
} from "@/types/appointment";

import { validateAppointmentSlot } from "@/services/appointmentValidationService";

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

export async function createAppointment(
  input: CreateAppointmentInput
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

  const { data: service, error: serviceError } = await supabase
    .from("services")
    .select("id, salon_id, name, duration_minutes, buffer_minutes, price, currency, is_active")
    .eq("id", serviceId)
    .eq("salon_id", salonId)
    .single();

  if (serviceError || !service) {
    throw new Error("Service not found.");
  }

  if (!service.is_active) {
    throw new Error("Service is not active.");
  }

  const { data: employeeService, error: employeeServiceError } = await supabase
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

  /**
   * MVP odluka:
   * end_time uključuje duration + buffer,
   * jer trenutno nemamo posebno blocked_until polje.
   */
  const appointmentEnd = addMinutes(
    appointmentStart,
    durationMinutes + bufferMinutes
  );

  const startIso = appointmentStart.toISOString();
  const endIso = appointmentEnd.toISOString();

  await validateAppointmentSlot({
    salonId,
    employeeId,
    serviceId,
    startTime: startIso,
    endTime: endIso,
  });

  const { data: conflictingAppointments, error: conflictError } = await supabase
    .from("appointments")
    .select("id")
    .eq("salon_id", salonId)
    .eq("employee_id", employeeId)
    .in("status", ["pending", "confirmed"])
    .lt("start_time", endIso)
    .gt("end_time", startIso);

  if (conflictError) {
    throw new Error("Failed to check appointment conflicts.");
  }

  if (conflictingAppointments && conflictingAppointments.length > 0) {
    throw new Error("This slot is no longer available.");
  }

  let clientId: string;

  const normalizedPhone = client.phone?.trim() || null;
  const normalizedEmail = client.email?.trim() || null;

  let existingClient = null;

  if (normalizedPhone) {
    const { data, error } = await supabase
      .from("clients")
      .select("id")
      .eq("salon_id", salonId)
      .eq("phone", normalizedPhone)
      .maybeSingle();

    if (error) {
      throw new Error("Failed to check existing client by phone.");
    }

    existingClient = data;
  }

  if (!existingClient && normalizedEmail) {
    const { data, error } = await supabase
      .from("clients")
      .select("id")
      .eq("salon_id", salonId)
      .eq("email", normalizedEmail)
      .maybeSingle();

    if (error) {
      throw new Error("Failed to check existing client by email.");
    }

    existingClient = data;
  }

  if (existingClient) {
    clientId = existingClient.id;
  } else {
    const { data: createdClient, error: clientError } = await supabase
      .from("clients")
      .insert({
        salon_id: salonId,
        full_name: client.fullName.trim(),
        phone: normalizedPhone,
        email: normalizedEmail,
        source: bookingSource,
      })
      .select("id")
      .single();

    if (clientError || !createdClient) {
      throw new Error("Failed to create client.");
    }

    clientId = createdClient.id;
  }

  const { data: appointment, error: appointmentError } = await supabase
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

  const { error: snapshotError } = await supabase
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

  return appointment;
}