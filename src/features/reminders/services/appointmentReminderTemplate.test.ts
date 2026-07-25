import assert from "node:assert/strict";
import test from "node:test";
import { buildAppointmentReminderSms, sanitizeSmsSalonName } from "./appointmentReminderTemplate.ts";

test("uses Sutra only for the next salon-local calendar day", () => {
  const message = buildAppointmentReminderSms({
    salonName: "Studio Ana",
    appointmentStart: "2026-07-28T12:00:00.000Z",
    salonTimezone: "Europe/Belgrade",
    now: new Date("2026-07-27T10:00:00.000Z"),
  });
  assert.equal(message, "Podsetnik: Sutra u 14:00 imate termin u salonu Studio Ana. Za promenu termina kontaktirajte salon.");
});

test("uses localized Serbian date when appointment is not tomorrow", () => {
  const message = buildAppointmentReminderSms({
    salonName: "Žad & Šišanje",
    appointmentStart: "2026-07-28T12:00:00.000Z",
    salonTimezone: "Europe/Belgrade",
    now: new Date("2026-07-25T10:00:00.000Z"),
  });
  assert.match(message, /28\. jula u 14:00/);
  assert.match(message, /Žad & Šišanje/);
  assert.ok(message.length < 320);
});

test("sanitizes control characters and bounds salon name length", () => {
  assert.equal(sanitizeSmsSalonName("  Studio\n\tAna  "), "Studio Ana");
  assert.equal(sanitizeSmsSalonName("x".repeat(100)).length, 80);
});
