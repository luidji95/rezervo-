import { readFile } from "node:fs/promises";
import path from "node:path";

import type { SupabaseClient } from "@supabase/supabase-js";

type SchemaProbeClient = {
  from(table: string): {
    select(columns: string): {
      limit(count: number): PromiseLike<{ error: { message: string } | null }>;
    };
  };
};

const TABLE_CONTRACT = {
  salons: "id,name,timezone,default_currency,status",
  employees: "id,salon_id,full_name,display_name,is_active,is_bookable,is_public",
  services: "id,salon_id,name,duration_minutes,buffer_minutes,price,currency,is_active",
  employee_services:
    "id,salon_id,employee_id,service_id,custom_duration_minutes,custom_price,is_active",
  clients: "id,salon_id,full_name,phone,email,source,created_at",
  appointments:
    "id,salon_id,client_id,employee_id,primary_service_id,start_time,end_time,duration_minutes,buffer_minutes,price,currency,status,payment_status,booking_source,idempotency_key,created_at",
  appointment_services:
    "id,appointment_id,service_id,service_name_snapshot,duration_minutes_snapshot,price_snapshot,sort_order",
  working_hours:
    "id,salon_id,employee_id,day_of_week,opens_at,closes_at,break_starts_at,break_ends_at,is_working_day",
  closures: "id,salon_id,employee_id,starts_at,ends_at,is_full_day",
} as const;

const EXPECTED_STATUSES = [
  "pending",
  "confirmed",
  "completed",
  "cancelled",
  "no_show",
] as const;

const EXPECTED_BOOKING_SOURCES = [
  "manual",
  "public",
  "ai",
  "whatsapp",
  "instagram",
] as const;

type OpenApiSchema = {
  definitions?: Record<
    string,
    { properties?: Record<string, { enum?: string[] }> }
  >;
};

export type SchemaValidationResult = {
  compatibleForDryRun: boolean;
  readyForWrites: boolean;
  tables: string[];
  appointmentStatuses: string[];
  bookingSources: string[];
  guards: {
    employeeServiceUnique: boolean;
    appointmentIdempotencyUnique: boolean;
    appointmentOverlapExclusion: boolean;
    snapshotAppointmentFk: boolean;
    snapshotServiceFk: boolean;
    snapshotDurationCheck: boolean;
    snapshotPriceCheck: boolean;
  };
  warnings: string[];
};

async function loadOpenApiSchema(supabaseUrl: string, serviceRoleKey: string) {
  const response = await fetch(`${supabaseUrl}/rest/v1/`, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Accept: "application/openapi+json",
    },
  });
  if (!response.ok) throw new Error(`OpenAPI schema request failed (${response.status}).`);
  return (await response.json()) as OpenApiSchema;
}

function assertEnumValues(actual: string[] | undefined, expected: readonly string[], label: string) {
  if (!actual || expected.some((value) => !actual.includes(value))) {
    throw new Error(`${label} enum is missing one or more required values.`);
  }
  return [...actual].sort();
}

async function verifyRepositoryGuards() {
  const migrationPath = path.resolve(
    process.cwd(),
    "supabase/migrations/202607220001_atomic_public_booking.sql",
  );
  const sql = await readFile(migrationPath, "utf8");
  if (!sql.includes("appointments_idempotency_key_uidx")) {
    throw new Error("Repository contract is missing the appointment idempotency index.");
  }
  if (!sql.includes("appointments_employee_time_no_overlap")) {
    throw new Error("Repository contract is missing the appointment overlap constraint.");
  }
}

export async function validateSchemaCompatibility(input: {
  supabase: SupabaseClient;
  supabaseUrl: string;
  serviceRoleKey: string;
}): Promise<SchemaValidationResult> {
  const schemaProbe = input.supabase as unknown as SchemaProbeClient;
  for (const [table, columns] of Object.entries(TABLE_CONTRACT)) {
    const { error } = await schemaProbe.from(table).select(columns).limit(0);
    if (error) {
      throw new Error(`Schema contract failed for public.${table}: ${error.message}`);
    }
  }

  const openApi = await loadOpenApiSchema(input.supabaseUrl, input.serviceRoleKey);
  const appointmentProperties = openApi.definitions?.appointments?.properties;
  const appointmentStatuses = assertEnumValues(
    appointmentProperties?.status?.enum,
    EXPECTED_STATUSES,
    "appointment_status",
  );
  const bookingSources = assertEnumValues(
    appointmentProperties?.booking_source?.enum,
    EXPECTED_BOOKING_SOURCES,
    "booking_source",
  );
  await verifyRepositoryGuards();

  const { data: catalogData, error: catalogError } = await input.supabase.rpc(
    "get_simulation_schema_contract",
  );
  const catalog = catalogData as {
    ready?: boolean;
    guards?: SchemaValidationResult["guards"];
  } | null;
  const readyForWrites = !catalogError && catalog?.ready === true;
  const guards = catalog?.guards ?? {
    employeeServiceUnique: false,
    appointmentIdempotencyUnique: false,
    appointmentOverlapExclusion: false,
    snapshotAppointmentFk: false,
    snapshotServiceFk: false,
    snapshotDurationCheck: false,
    snapshotPriceCheck: false,
  };

  return {
    compatibleForDryRun: true,
    readyForWrites,
    tables: Object.keys(TABLE_CONTRACT),
    appointmentStatuses,
    bookingSources,
    guards,
    warnings: readyForWrites
      ? []
      : [
          catalogError?.message ?? "Simulation catalog contract is not ready.",
          "Database writes remain locked until migration 202607220014 is applied and all catalog guards pass.",
        ],
  };
}
