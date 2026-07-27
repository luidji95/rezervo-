export function getAppointmentMutationMessage(error: unknown): string {
  const message = error && typeof error === "object" && "message" in error ? String(error.message) : "";
  if (message.includes("APPOINTMENT_ACCESS_REQUIRED")) return "Vaš nalog trenutno ima pristup samo za pregled. Aktivirajte paket da biste menjali termine.";
  if (message.includes("APPOINTMENT_NOT_FOUND")) return "Termin nije pronađen.";
  if (message.includes("FORBIDDEN")) return "Nemate dozvolu za ovu izmenu.";
  if (message.includes("INVALID_STATUS_TRANSITION") || message.includes("APPOINTMENT_ALREADY_UPDATED")) return "Termin je u međuvremenu promenjen. Osvežite podatke.";
  if (message.includes("SERVICE_NOT_ASSIGNED")) return "Izabrani zaposleni ne pruža ovu uslugu.";
  if (message.includes("IDEMPOTENCY_CONFLICT")) return "Zahtev je već iskorišćen za drugi termin.";
  if (error && typeof error === "object" && "code" in error && String(error.code) === "23P01") return "Izabrani termin više nije slobodan.";
  return "Izmenu termina trenutno nije moguće sačuvati.";
}
