export type AppointmentReminderTemplateInput = {
  salonName: string;
  appointmentStart: string;
  salonTimezone: string;
  serviceName?: string | null;
  now?: Date;
};

const MONTHS = [
  "januara", "februara", "marta", "aprila", "maja", "juna",
  "jula", "avgusta", "septembra", "oktobra", "novembra", "decembra",
];

function localParts(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return { year: read("year"), month: read("month"), day: read("day"), hour: read("hour"), minute: read("minute") };
}

export function sanitizeSmsSalonName(value: string) {
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) return "salonu";
  return normalized.length <= 80 ? normalized : `${normalized.slice(0, 79).trimEnd()}…`;
}

export function buildAppointmentReminderSms(input: AppointmentReminderTemplateInput) {
  const appointment = new Date(input.appointmentStart);
  if (Number.isNaN(appointment.getTime())) throw new Error("INVALID_APPOINTMENT_START");

  const now = input.now ?? new Date();
  const appointmentParts = localParts(appointment, input.salonTimezone);
  const tomorrowParts = localParts(new Date(now.getTime() + 86_400_000), input.salonTimezone);
  const isTomorrow = appointmentParts.year === tomorrowParts.year
    && appointmentParts.month === tomorrowParts.month
    && appointmentParts.day === tomorrowParts.day;
  const time = `${String(appointmentParts.hour).padStart(2, "0")}:${String(appointmentParts.minute).padStart(2, "0")}`;
  const dateLabel = isTomorrow
    ? `Sutra u ${time}`
    : `${appointmentParts.day}. ${MONTHS[appointmentParts.month - 1]} u ${time}`;
  const salonName = sanitizeSmsSalonName(input.salonName);

  return `Podsetnik: ${dateLabel} imate termin u salonu ${salonName}. Za promenu termina kontaktirajte salon.`;
}
