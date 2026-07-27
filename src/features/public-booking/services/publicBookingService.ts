import type {
  CreatePublicBookingInput,
  CreatePublicBookingResult,
  PublicAvailabilityInput,
  PublicAvailabilitySlot,
  PublicEmployee,
} from "../types";

export class PublicBookingConflictError extends Error {
  constructor() {
    super("Selected booking slot is no longer available.");
    this.name = "PublicBookingConflictError";
  }
}

export class PublicBookingUnavailableError extends Error {
  constructor() {
    super("Online booking is currently unavailable.");
    this.name = "PublicBookingUnavailableError";
  }
}

function isPublicAvailabilitySlot(
  value: unknown
): value is PublicAvailabilitySlot {
  if (!value || typeof value !== "object") return false;

  const slot = value as Record<string, unknown>;
  return (
    typeof slot.startTime === "string" &&
    typeof slot.endTime === "string" &&
    typeof slot.employeeId === "string"
  );
}

export async function getPublicEmployeesForService(
  salonId: string,
  serviceId: string
): Promise<PublicEmployee[]> {
  const response = await fetch("/api/public-booking/employees", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ salonId, serviceId }),
  });
  if (!response.ok) throw new Error("Public employees request failed.");
  const body = await response.json() as { success?: boolean; employees?: PublicEmployee[] };
  if (body.success !== true || !Array.isArray(body.employees)) throw new Error("Invalid public employees response.");
  return body.employees;
}

export async function getPublicAvailability(
  input: PublicAvailabilityInput,
  signal?: AbortSignal
): Promise<PublicAvailabilitySlot[]> {
  const response = await fetch("/api/public-booking/availability", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
    signal,
  });

  if (!response.ok) {
    throw new Error("Public availability request failed.");
  }

  const body: unknown = await response.json();

  if (
    !body ||
    typeof body !== "object" ||
    !("success" in body) ||
    body.success !== true ||
    !("slots" in body) ||
    !Array.isArray(body.slots) ||
    !body.slots.every(isPublicAvailabilitySlot)
  ) {
    throw new Error("Invalid public availability response.");
  }

  return body.slots;
}

export async function createPublicBooking(
  input: CreatePublicBookingInput
): Promise<CreatePublicBookingResult> {
  const response = await fetch("/api/public-booking/create", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  if (response.status === 409) {
    throw new PublicBookingConflictError();
  }

  if (response.status === 403) throw new PublicBookingUnavailableError();

  if (!response.ok) {
    throw new Error("Public booking request failed.");
  }

  const body: unknown = await response.json();

  if (
    !body ||
    typeof body !== "object" ||
    !("success" in body) ||
    body.success !== true ||
    !("appointmentId" in body) ||
    typeof body.appointmentId !== "string"
  ) {
    throw new Error("Invalid public booking response.");
  }

  return { appointmentId: body.appointmentId };
}
