import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedRequestUser } from "@/lib/server/requestAuth";
import {
  getEmployeeAppointmentAccessError,
  getEmployeeAppointmentContext,
} from "@/lib/server/employeeAppointmentContext";
import { supabaseServer } from "@/lib/supabaseServer";
import { generateAvailableSlots } from "@/services/availabilityService";
import {
  createNotification,
  formatNotificationAppointmentTime,
} from "@/services/notificationService";
import {
  normalizeClientEmail,
  normalizeClientPhone,
} from "@/services/clientService";
import {
  optionalEmailSchema,
  optionalPhoneSchema,
  requiredStringSchema,
} from "@/lib/validation/commonSchemas";
import { DEFAULT_SALON_TIME_ZONE, getDateKeyInTimeZone } from "@/lib/salonDateTime";

const createSchema = z
  .object({
    serviceId: z.string().uuid(),
    startTime: z.string().datetime({ offset: true }),
    customer: z.object({
      fullName: requiredStringSchema("Ime i prezime", 2, 120),
      phone: optionalPhoneSchema.optional(),
      email: optionalEmailSchema.optional(),
    }),
    note: z.string().trim().max(1000).optional(),
    idempotencyKey: z.string().uuid(),
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.customer.phone && !value.customer.email) {
      context.addIssue({
        code: "custom",
        path: ["customer", "phone"],
        message: "Unesite telefon ili email.",
      });
    }
  });

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ success: false, code, message }, { status });
}

function postgresCode(error: unknown) {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : null;
}

function mapRpcError(error: { code?: string; message?: string }) {
  const code = error.message?.trim();
  if (code === "SERVICE_NOT_ASSIGNED") {
    return errorResponse("SERVICE_NOT_ASSIGNED", "Usluga nije dostupna.", 404);
  }
  if (code === "CLIENT_CONFLICT") {
    return errorResponse("CLIENT_CONFLICT", "Kontakt podaci pripadaju različitim klijentima.", 409);
  }
  if (code === "IDEMPOTENCY_CONFLICT") {
    return errorResponse("IDEMPOTENCY_CONFLICT", "Zahtev je već iskorišćen za drugi termin.", 409);
  }
  if (postgresCode(error) === "23P01") {
    return errorResponse("APPOINTMENT_CONFLICT", "Izabrani termin više nije dostupan.", 409);
  }
  if (postgresCode(error) === "22023") {
    return errorResponse("INVALID_INPUT", "Podaci termina nisu ispravni.", 400);
  }
  return errorResponse("CREATE_FAILED", "Termin trenutno nije moguće kreirati.", 500);
}

export async function GET(request: Request) {
  const auth = await getAuthenticatedRequestUser(request);
  if (!auth.ok) return errorResponse("UNAUTHORIZED", "Morate biti prijavljeni.", 401);

  const context = await getEmployeeAppointmentContext(auth.user.id);
  if (!context) {
    const code = await getEmployeeAppointmentAccessError(auth.user.id);
    return errorResponse(code, "Nalog nije povezan sa aktivnim zaposlenim.", 403);
  }

  const { data, error } = await supabaseServer
    .from("employee_services")
    .select(
      `
      custom_duration_minutes,
      custom_price,
      services!inner(id, name, duration_minutes, price, currency, is_active)
    `,
    )
    .eq("salon_id", context.salonId)
    .eq("employee_id", context.employeeId)
    .eq("is_active", true)
    .eq("services.is_active", true);

  if (error) return errorResponse("CREATE_FAILED", "Usluge trenutno nisu dostupne.", 500);

  return NextResponse.json({
    success: true,
    services: (data ?? []).map((relation) => {
      const service = relation.services as unknown as {
        id: string;
        name: string;
        duration_minutes: number;
        price: number;
        currency: string;
      };
      return {
        id: service.id,
        name: service.name,
        durationMinutes: relation.custom_duration_minutes ?? service.duration_minutes,
        price: relation.custom_price ?? service.price,
        currency: service.currency,
      };
    }),
  });
}

export async function POST(request: Request) {
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse("INVALID_INPUT", "Proverite unete podatke.", 400);

  const auth = await getAuthenticatedRequestUser(request);
  if (!auth.ok) return errorResponse("UNAUTHORIZED", "Morate biti prijavljeni.", 401);

  const baseContext = await getEmployeeAppointmentContext(auth.user.id);
  if (!baseContext) {
    const code = await getEmployeeAppointmentAccessError(auth.user.id);
    return errorResponse(code, "Nemate dozvolu za kreiranje termina.", 403);
  }
  const context = await getEmployeeAppointmentContext(auth.user.id, parsed.data.serviceId);
  if (!context) return errorResponse("SERVICE_NOT_ASSIGNED", "Usluga nije dostupna.", 404);

  const start = new Date(parsed.data.startTime);
  const timeZone = context.salonTimeZone || DEFAULT_SALON_TIME_ZONE;
  let availability;
  try {
    availability = await generateAvailableSlots(
      {
        salonId: context.salonId,
        employeeId: context.employeeId,
        serviceId: parsed.data.serviceId,
        date: getDateKeyInTimeZone(start, timeZone),
      },
      supabaseServer,
    );
  } catch {
    return errorResponse("CREATE_FAILED", "Dostupnost trenutno nije moguće proveriti.", 500);
  }

  const available = availability?.slots.some(
    (slot) =>
      slot.employeeId === context.employeeId &&
      new Date(slot.startTime).getTime() === start.getTime(),
  );
  if (!available) return errorResponse("SLOT_UNAVAILABLE", "Izabrani termin više nije dostupan.", 409);

  const { data, error } = await supabaseServer.rpc(
    "create_employee_appointment_atomic",
    {
      p_profile_id: auth.user.id,
      p_service_id: parsed.data.serviceId,
      p_start_time: parsed.data.startTime,
      p_customer_full_name: parsed.data.customer.fullName,
      p_customer_phone: normalizeClientPhone(parsed.data.customer.phone) ?? "",
      p_customer_email: normalizeClientEmail(parsed.data.customer.email) ?? "",
      p_customer_note: parsed.data.note ?? "",
      p_idempotency_key: parsed.data.idempotencyKey,
    },
  );
  if (error) return mapRpcError(error);

  const result = Array.isArray(data) ? data[0] : null;
  if (!result) return errorResponse("CREATE_FAILED", "Termin trenutno nije moguće kreirati.", 500);

  if (result.was_created) {
    const notification = await createNotification(
      {
        salonId: result.salon_id,
        type: "appointment_created",
        title: "Novi termin",
        message: `${result.customer_name} — ${result.service_name}, ${formatNotificationAppointmentTime(result.appointment_start)}`,
        entityType: "appointment",
        entityId: result.appointment_id,
      },
      supabaseServer,
    );

    if (!notification && process.env.NODE_ENV === "development") {
      console.error("EMPLOYEE_APPOINTMENT_NOTIFICATION_MISSING", {
        appointmentCreated: true,
        notificationInsertAttempted: true,
        appointmentIdPresent: Boolean(result.appointment_id),
      });
    }
  }

  return NextResponse.json(
    {
      success: true,
      appointment: {
        id: result.appointment_id,
        status: result.appointment_status,
        startTime: result.appointment_start,
      },
    },
    { status: result.was_created ? 201 : 200 },
  );
}
