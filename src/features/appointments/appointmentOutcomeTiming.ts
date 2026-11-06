// completed and no_show are only accepted by the database from the scheduled end_time (server clock).
// The UI uses the device clock only to explain the wait; the backend stays authoritative.
export const APPOINTMENT_NOT_ENDED_MESSAGE =
  "Termin još nije završen. Status „Završeno“ ili „Nije došao“ možete postaviti tek posle zakazanog kraja termina.";

export function isOutcomeStatus(status: string) {
  return status === "completed" || status === "no_show";
}

export function hasAppointmentEnded(endTime: string, now: number = Date.now()) {
  const end = new Date(endTime).getTime();
  return Number.isFinite(end) && end <= now;
}

export function getAppointmentNotEndedHint(endTime: string, timeZone?: string) {
  const end = new Date(endTime);
  const time = end.toLocaleTimeString("sr-RS", { hour: "2-digit", minute: "2-digit", ...(timeZone ? { timeZone } : {}) });
  return `„Završeno“ i „Nije došao“ su dostupni od ${time}, posle kraja termina.`;
}
