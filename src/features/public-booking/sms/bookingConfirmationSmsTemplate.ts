import { sanitizeSmsSalonName } from "../../reminders/services/appointmentReminderTemplate.ts";

const MONTHS = [
  "januara", "februara", "marta", "aprila", "maja", "juna",
  "jula", "avgusta", "septembra", "oktobra", "novembra", "decembra",
];

// Serbian letters outside the GSM-7 alphabet; keeping the text GSM-7 keeps the message at 2 SMS parts instead of 4.
const TRANSLITERATION: Record<string, string> = { č: "c", ć: "c", š: "s", ž: "z", đ: "dj", Č: "C", Ć: "C", Š: "S", Ž: "Z", Đ: "Dj" };

export function toSmsAscii(value: string) {
  return value.replace(/[čćšžđČĆŠŽĐ]/g, (letter) => TRANSLITERATION[letter]);
}

export type BookingConfirmationSmsInput = {
  salonName: string;
  appointmentStart: string;
  salonTimezone: string;
  manageLink: string;
};

export function buildBookingConfirmationSms(input: BookingConfirmationSmsInput) {
  const start = new Date(input.appointmentStart);
  if (Number.isNaN(start.getTime())) throw new Error("INVALID_APPOINTMENT_START");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: input.salonTimezone, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(start);
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const salon = toSmsAscii(sanitizeSmsSalonName(input.salonName));
  const when = `${Number(read("day"))}. ${MONTHS[Number(read("month")) - 1]} u ${read("hour")}:${read("minute")}`;
  return `Termin u salonu ${salon} je potvrdjen za ${when}. Pregled i otkazivanje: ${input.manageLink}`;
}
