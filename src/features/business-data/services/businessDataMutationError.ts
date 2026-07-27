type DatabaseMutationError = { message?: string; code?: string };

const SAFE_CODES = [
  "SALON_WRITE_ACCESS_REQUIRED", "FORBIDDEN", "CLIENT_NOT_FOUND",
  "CLIENT_CONTACT_CONFLICT", "CLIENT_HAS_HISTORY", "SERVICE_NOT_FOUND",
  "SERVICE_IN_USE", "CATEGORY_NOT_FOUND", "CATEGORY_IN_USE",
  "EMPLOYEE_NOT_FOUND", "SERVICE_NOT_ASSIGNED", "INVALID_INPUT",
  "CROSS_TENANT_REFERENCE",
] as const;

export type BusinessDataMutationCode = (typeof SAFE_CODES)[number];

export class BusinessDataMutationError extends Error {
  readonly code: BusinessDataMutationCode;
  constructor(code: BusinessDataMutationCode) {
    super(code);
    this.code = code;
    this.name = code;
  }
}

export function throwBusinessDataMutationError(error: DatabaseMutationError): never {
  const code = SAFE_CODES.find((candidate) => error.message?.includes(candidate));
  throw new BusinessDataMutationError(code ?? "INVALID_INPUT");
}

export function getBusinessDataMutationMessage(error: unknown, fallback: string) {
  if (!(error instanceof BusinessDataMutationError)) return fallback;
  if (error.code === "SALON_WRITE_ACCESS_REQUIRED") return "Vaš nalog trenutno ima pristup samo za pregled. Aktivirajte paket da biste menjali poslovne podatke.";
  if (error.code === "FORBIDDEN") return "Nemate ovlašćenje za ovu izmenu.";
  if (error.code === "CLIENT_CONTACT_CONFLICT") return "Klijent sa ovim kontaktom već postoji.";
  if (error.code === "CATEGORY_IN_USE") return "Kategorija sadrži usluge i ne može se obrisati.";
  if (error.code === "CROSS_TENANT_REFERENCE") return "Izabrani podaci ne pripadaju ovom salonu.";
  return fallback;
}
