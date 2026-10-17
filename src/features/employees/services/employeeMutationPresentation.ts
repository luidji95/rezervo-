export function getEmployeeMutationMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  if (error.name === "EMPLOYEE_PURCHASE_LIMIT_PENDING") return "Započeta kupovina paketa ograničava broj aktivnih zaposlenih dok se ne završi.";
  if (error.name === "EMPLOYEE_LIMIT_REACHED") return "Dostigli ste maksimalan broj zaposlenih za trenutni paket.";
  if (error.name === "EMPLOYEE_ACCESS_REQUIRED") return "Pretplata trenutno ne dozvoljava aktiviranje zaposlenih.";
  if (error.name === "FORBIDDEN") return "Nemate ovlašćenje za izmenu ovog zaposlenog.";
  if (error.name === "EMPLOYEE_NOT_FOUND") return "Zaposleni nije pronađen.";
  return fallback;
}
