import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  addDaysToDateKey,
  getDayOfWeekFromDateKey,
  zonedDateTimeToUtc,
} from "../../../src/lib/salonDateTime.ts";
import type { FoundationServiceAssignment, SimulationFoundation } from "../readers/foundationReader.ts";
import { deterministicUuid } from "../core/ids.ts";
import { createDeterministicRng, type DeterministicRng } from "../core/rng.ts";

export type SimulationClientRow = {
  id: string;
  full_name: string;
  phone: string;
  email: string | null;
  source: string;
  created_at: string;
};

export type SimulationAppointmentRow = {
  id: string;
  snapshot_id: string;
  client_id: string;
  employee_id: string;
  service_id: string;
  service_name_snapshot: string;
  start_time: string;
  end_time: string;
  duration_minutes: number;
  buffer_minutes: number;
  price: number;
  currency: string;
  status: "completed" | "cancelled" | "no_show";
  payment_status: "unpaid";
  booking_source: string;
  cancellation_reason: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  confirmed_at: string | null;
  completed_at: string | null;
  created_at: string;
  idempotency_key: string;
};

type WorkingHourRow = {
  employee_id: string | null;
  day_of_week: number;
  opens_at: string;
  closes_at: string;
  break_starts_at: string | null;
  break_ends_at: string | null;
  is_working_day: boolean;
};

type ClosureRow = {
  employee_id: string | null;
  starts_at: string;
  ends_at: string;
};

type ExistingAppointmentRow = {
  id: string;
  employee_id: string | null;
  start_time: string;
  end_time: string;
};

type ExistingClientRow = { id: string; phone: string | null; email: string | null };

type Candidate = {
  assignment: FoundationServiceAssignment;
  start: Date;
  end: Date;
};

const FIRST_NAMES = ["Ana", "Jelena", "Milica", "Marija", "Ivana", "Sara", "Nikola", "Marko", "Luka", "Stefan"];
const LAST_NAMES = ["Jovanovic", "Petrovic", "Nikolic", "Ilic", "Pavlovic", "Markovic", "Stojanovic", "Djordjevic"];
const STATUS_WEIGHTS = [
  { value: "completed" as const, weight: 84 },
  { value: "cancelled" as const, weight: 11 },
  { value: "no_show" as const, weight: 5 },
];
const SOURCE_WEIGHTS = [
  { value: "manual", weight: 48 },
  { value: "public", weight: 32 },
  { value: "whatsapp", weight: 10 },
  { value: "instagram", weight: 7 },
  { value: "ai", weight: 3 },
];

function normalizePhone(value: string | null) {
  return value?.trim().replace(/[\s()-]/g, "") || null;
}

function normalizeEmail(value: string | null) {
  return value?.trim().toLowerCase() || null;
}

function addMinutes(value: Date, minutes: number) {
  return new Date(value.getTime() + minutes * 60_000);
}

function addHours(value: Date, hours: number) {
  return addMinutes(value, hours * 60);
}

function addDays(value: Date, days: number) {
  return new Date(value.getTime() + days * 86_400_000);
}

function overlaps(firstStart: Date, firstEnd: Date, secondStart: Date, secondEnd: Date) {
  return firstStart < secondEnd && firstEnd > secondStart;
}

function batchChecksum(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function shuffle<T>(values: T[], rng: DeterministicRng) {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const target = rng.integer(0, index);
    [values[index], values[target]] = [values[target], values[index]];
  }
  return values;
}

async function readGenerationState(
  supabase: SupabaseClient,
  salonId: string,
  startUtc: string,
  endUtc: string,
) {
  const [clients, hours, closures, appointments] = await Promise.all([
    supabase.from("clients").select("id,phone,email").eq("salon_id", salonId),
    supabase
      .from("working_hours")
      .select("employee_id,day_of_week,opens_at,closes_at,break_starts_at,break_ends_at,is_working_day")
      .eq("salon_id", salonId),
    supabase
      .from("closures")
      .select("employee_id,starts_at,ends_at")
      .eq("salon_id", salonId)
      .lt("starts_at", endUtc)
      .gt("ends_at", startUtc),
    supabase
      .from("appointments")
      .select("id,employee_id,start_time,end_time")
      .eq("salon_id", salonId)
      .lt("start_time", endUtc)
      .gt("end_time", startUtc),
  ]);
  const error = [clients.error, hours.error, closures.error, appointments.error].find(Boolean);
  if (error) throw new Error(`Generation state read failed: ${error.message}`);
  return {
    clients: (clients.data ?? []) as ExistingClientRow[],
    hours: (hours.data ?? []) as WorkingHourRow[],
    closures: (closures.data ?? []) as ClosureRow[],
    appointments: (appointments.data ?? []) as ExistingAppointmentRow[],
  };
}

function generateClients(input: {
  count: number;
  identity: string;
  dateRangeStart: string;
  existing: ExistingClientRow[];
  rng: DeterministicRng;
}) {
  const phones = new Set(input.existing.map((client) => normalizePhone(client.phone)).filter(Boolean));
  const emails = new Set(input.existing.map((client) => normalizeEmail(client.email)).filter(Boolean));
  const clients: SimulationClientRow[] = [];
  const runToken = deterministicUuid(`contacts:${input.identity}`).replaceAll("-", "").slice(0, 10);

  for (let index = 0; index < input.count; index += 1) {
    let nonce = index;
    let phone: string;
    let email: string | null;
    do {
      const digits = createHash("sha256")
        .update(`${input.identity}:contact:${nonce}`)
        .digest("hex")
        .slice(0, 7)
        .split("")
        .map((value) => Number.parseInt(value, 16) % 10)
        .join("");
      phone = `+38160${digits}`;
      email = input.rng.next() < 0.75
        ? `sim.${runToken}.${nonce}@example.invalid`
        : null;
      nonce += input.count;
    } while (phones.has(phone) || (email !== null && emails.has(email)));

    phones.add(phone);
    if (email) emails.add(email);
    clients.push({
      id: deterministicUuid(`${input.identity}:client:${index}`),
      full_name: `${FIRST_NAMES[input.rng.integer(0, FIRST_NAMES.length - 1)]} ${LAST_NAMES[input.rng.integer(0, LAST_NAMES.length - 1)]}`,
      phone,
      email,
      source: input.rng.weighted(SOURCE_WEIGHTS),
      created_at: `${input.dateRangeStart}T00:00:00.000Z`,
    });
  }
  return clients;
}

function getSchedule(hours: WorkingHourRow[], employeeId: string, dayOfWeek: number) {
  return hours.find((hour) => hour.employee_id === employeeId && hour.day_of_week === dayOfWeek)
    ?? hours.find((hour) => hour.employee_id === null && hour.day_of_week === dayOfWeek)
    ?? null;
}

function buildCandidates(input: {
  foundation: SimulationFoundation;
  startDate: string;
  endDate: string;
  count: number;
  hours: WorkingHourRow[];
  closures: ClosureRow[];
  existingAppointments: ExistingAppointmentRow[];
  rng: DeterministicRng;
}) {
  const candidates: Candidate[] = [];
  const byEmployee = Map.groupBy(input.foundation.assignments, (assignment) => assignment.employeeId);
  let dateKey = input.startDate;

  while (dateKey < input.endDate) {
    const dayOfWeek = getDayOfWeekFromDateKey(dateKey);
    for (const [employeeId, assignments] of [...byEmployee.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const schedule = getSchedule(input.hours, employeeId, dayOfWeek);
      if (!schedule?.is_working_day) continue;
      const workEnd = zonedDateTimeToUtc(dateKey, schedule.closes_at, input.foundation.salon.timezone);
      const breakStart = schedule.break_starts_at
        ? zonedDateTimeToUtc(dateKey, schedule.break_starts_at, input.foundation.salon.timezone)
        : null;
      const breakEnd = schedule.break_ends_at
        ? zonedDateTimeToUtc(dateKey, schedule.break_ends_at, input.foundation.salon.timezone)
        : null;
      let cursor = zonedDateTimeToUtc(dateKey, schedule.opens_at, input.foundation.salon.timezone);

      while (cursor < workEnd) {
        const assignment = assignments[input.rng.integer(0, assignments.length - 1)];
        const end = addMinutes(cursor, assignment.durationMinutes + assignment.bufferMinutes);
        if (end > workEnd) break;
        const closureConflict = input.closures.some((closure) =>
          (closure.employee_id === null || closure.employee_id === employeeId)
          && overlaps(cursor, end, new Date(closure.starts_at), new Date(closure.ends_at)),
        );
        const appointmentConflict = input.existingAppointments.some((appointment) =>
          appointment.employee_id === employeeId
          && overlaps(cursor, end, new Date(appointment.start_time), new Date(appointment.end_time)),
        );
        const breakConflict = breakStart && breakEnd && overlaps(cursor, end, breakStart, breakEnd);

        if (!closureConflict && !appointmentConflict && !breakConflict && input.rng.next() < 0.68) {
          candidates.push({ assignment, start: cursor, end });
          cursor = end;
        } else {
          cursor = addMinutes(cursor, 15);
        }
      }
    }
    dateKey = addDaysToDateKey(dateKey, 1);
  }

  if (candidates.length < input.count) {
    throw new Error(`Insufficient historical capacity: ${candidates.length} slots for ${input.count} appointments.`);
  }
  return shuffle(candidates, input.rng).slice(0, input.count).sort((a, b) => a.start.getTime() - b.start.getTime());
}

export async function generateSimulationPlan(input: {
  supabase: SupabaseClient;
  foundation: SimulationFoundation;
  identity: string;
  clientsCount: number;
  appointmentsCount: number;
  startDate: string;
  endDate: string;
  allowedBookingSources: string[];
  batchSize: number;
}) {
  const rng = createDeterministicRng(input.identity);
  const plannedClientIds = new Set(
    Array.from({ length: input.clientsCount }, (_, index) =>
      deterministicUuid(`${input.identity}:client:${index}`),
    ),
  );
  const plannedAppointmentIds = new Set(
    Array.from({ length: input.appointmentsCount }, (_, index) =>
      deterministicUuid(`${input.identity}:appointment:${index}`),
    ),
  );
  const startUtc = zonedDateTimeToUtc(input.startDate, "00:00:00", input.foundation.salon.timezone);
  const endUtc = zonedDateTimeToUtc(input.endDate, "00:00:00", input.foundation.salon.timezone);
  const state = await readGenerationState(
    input.supabase,
    input.foundation.salon.id,
    startUtc.toISOString(),
    endUtc.toISOString(),
  );
  const clients = generateClients({
    count: input.clientsCount,
    identity: input.identity,
    dateRangeStart: input.startDate,
    existing: state.clients.filter((client) => !plannedClientIds.has(client.id)),
    rng,
  });
  const candidates = buildCandidates({
    foundation: input.foundation,
    startDate: input.startDate,
    endDate: input.endDate,
    count: input.appointmentsCount,
    hours: state.hours,
    closures: state.closures,
    existingAppointments: state.appointments.filter(
      (appointment) => !plannedAppointmentIds.has(appointment.id),
    ),
    rng,
  });
  const sourceWeights = SOURCE_WEIGHTS.filter((entry) => input.allowedBookingSources.includes(entry.value));
  const appointments = candidates.map((candidate, index): SimulationAppointmentRow => {
    const status = rng.weighted(STATUS_WEIGHTS);
    const source = rng.weighted(sourceWeights);
    const clientIndex = Math.min(clients.length - 1, Math.floor(Math.pow(rng.next(), 1.8) * clients.length));
    const createdAt = addDays(candidate.start, -rng.integer(1, 21));
    const confirmedAt = status === "cancelled" && rng.next() < 0.45
      ? addHours(candidate.start, -rng.integer(12, 72))
      : status === "completed" || status === "no_show"
        ? addHours(candidate.start, -rng.integer(12, 72))
        : null;
    const cancelledAt = status === "cancelled"
      ? addHours(candidate.start, -rng.integer(2, 48))
      : null;
    return {
      id: deterministicUuid(`${input.identity}:appointment:${index}`),
      snapshot_id: deterministicUuid(`${input.identity}:snapshot:${index}`),
      client_id: clients[clientIndex].id,
      employee_id: candidate.assignment.employeeId,
      service_id: candidate.assignment.serviceId,
      service_name_snapshot: candidate.assignment.serviceName,
      start_time: candidate.start.toISOString(),
      end_time: candidate.end.toISOString(),
      duration_minutes: candidate.assignment.durationMinutes,
      buffer_minutes: candidate.assignment.bufferMinutes,
      price: candidate.assignment.price,
      currency: input.foundation.salon.currency,
      status,
      payment_status: "unpaid",
      booking_source: source,
      cancellation_reason: status === "cancelled" ? "Otkazano od strane klijenta" : null,
      cancelled_at: cancelledAt?.toISOString() ?? null,
      cancelled_by: status === "cancelled" ? "simulation" : null,
      confirmed_at: confirmedAt?.toISOString() ?? null,
      completed_at: status === "completed" ? candidate.end.toISOString() : null,
      created_at: createdAt.toISOString(),
      idempotency_key: deterministicUuid(`${input.identity}:idempotency:${index}`),
    };
  });

  const clientBatches = Array.from(
    { length: Math.ceil(clients.length / input.batchSize) },
    (_, index) => clients.slice(index * input.batchSize, (index + 1) * input.batchSize),
  );
  const appointmentBatches = Array.from(
    { length: Math.ceil(appointments.length / input.batchSize) },
    (_, index) => appointments.slice(index * input.batchSize, (index + 1) * input.batchSize),
  );
  return {
    clients,
    appointments,
    clientBatches,
    appointmentBatches,
    clientBatchChecksums: clientBatches.map(batchChecksum),
    appointmentBatchChecksums: appointmentBatches.map(batchChecksum),
  };
}
