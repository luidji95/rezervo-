import { z } from "zod";

const COMMON_EMAIL_TLD_TYPOS = new Set(["cmo", "comn", "con", "comm", "lom"]);
const PHONE_PATTERN = /^\+?[0-9][0-9\s()\-/]{5,19}$/;
const INSTAGRAM_USERNAME_PATTERN = /^@?[a-zA-Z0-9._]{1,30}$/;

export const EMAIL_ERROR = "Unesite ispravnu email adresu.";
export const PHONE_ERROR = "Telefon nije u ispravnom formatu.";
export const URL_ERROR = "Unesite ispravan URL.";

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email(EMAIL_ERROR)
  .max(254, EMAIL_ERROR)
  .refine((email) => {
    const domain = email.split("@")[1];
    const domainParts = domain?.split(".") ?? [];
    const tld = domainParts[domainParts.length - 1]?.toLowerCase() ?? "";

    return (
      Boolean(domain?.includes(".")) &&
      /^[a-z]{2,24}$/i.test(tld) &&
      !COMMON_EMAIL_TLD_TYPOS.has(tld)
    );
  }, EMAIL_ERROR);

export const optionalEmailSchema = z.union([emailSchema, z.literal("")]);

export const phoneSchema = z
  .string()
  .trim()
  .min(1, PHONE_ERROR)
  .regex(PHONE_PATTERN, PHONE_ERROR)
  .refine((value) => value.replace(/\D/g, "").length >= 6, PHONE_ERROR);

export const optionalPhoneSchema = z.union([phoneSchema, z.literal("")]);

export function requiredStringSchema(label: string, min = 1, max = 120) {
  return z
    .string()
    .trim()
    .min(min, `${label} je obavezan.`)
    .max(max, `${label} je predugačak.`);
}

export const optionalTrimmedStringSchema = (max = 500) =>
  z.string().trim().max(max, "Uneta vrednost je predugačka.").optional();

export const optionalUrlSchema = z
  .string()
  .trim()
  .refine((value) => value === "" || URL.canParse(value), URL_ERROR);

export const optionalInstagramSchema = z
  .string()
  .trim()
  .refine(
    (value) =>
      value === "" ||
      URL.canParse(value) ||
      INSTAGRAM_USERNAME_PATTERN.test(value),
    "Unesite Instagram korisničko ime ili URL.",
  );
