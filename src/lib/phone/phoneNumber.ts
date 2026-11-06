// Phone normalization for public booking, mirrored in SQL by public.normalize_phone_e164_v1 (migration 054).
// Serbian domestic numbers (0 + national number) and their +381 / 00381 forms become the same E.164 number;
// other international numbers are accepted generically (country code + 8–15 digits in total), not limited to Serbia.
export const PHONE_EXAMPLE = "064 123 4567 ili +381 64 123 4567";
export const PHONE_REQUIRED_MESSAGE = "Unesite broj telefona.";
export const PHONE_INVALID_MESSAGE = `Broj telefona nije ispravan. Primer: ${PHONE_EXAMPLE}.`;

const SERBIAN_NATIONAL_NUMBER = /^[1-9][0-9]{7,9}$/;
const E164_DIGITS = /^[1-9][0-9]{7,14}$/;

export type PhoneNormalization = { ok: true; e164: string } | { ok: false; reason: "empty" | "invalid" };

export function normalizePhoneToE164(input: string | null | undefined): PhoneNormalization {
  let value = (input ?? "").replace(/[\s  ().\-/]/g, "");
  if (!value) return { ok: false, reason: "empty" };
  if (value.startsWith("00")) value = `+${value.slice(2)}`;

  if (value.startsWith("+")) {
    const digits = value.slice(1);
    if (!/^[0-9]+$/.test(digits)) return { ok: false, reason: "invalid" };
    if (digits.startsWith("381")) {
      // "+381 064 …" is a common way to write the same number; the trunk 0 is not part of E.164.
      const national = digits.slice(3).replace(/^0/, "");
      return SERBIAN_NATIONAL_NUMBER.test(national) ? { ok: true, e164: `+381${national}` } : { ok: false, reason: "invalid" };
    }
    return E164_DIGITS.test(digits) ? { ok: true, e164: `+${digits}` } : { ok: false, reason: "invalid" };
  }

  if (/^0[0-9]+$/.test(value)) {
    const national = value.slice(1);
    return SERBIAN_NATIONAL_NUMBER.test(national) ? { ok: true, e164: `+381${national}` } : { ok: false, reason: "invalid" };
  }

  // Digits without a leading 0 or + (e.g. "641234567") are ambiguous and are rejected with the example.
  return { ok: false, reason: "invalid" };
}

export function getPhoneValidationMessage(input: string | null | undefined) {
  const result = normalizePhoneToE164(input);
  if (result.ok) return null;
  return result.reason === "empty" ? PHONE_REQUIRED_MESSAGE : PHONE_INVALID_MESSAGE;
}
