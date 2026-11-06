import type { SmsProvider, SmsSendResult } from "../../reminders/types/smsProvider.ts";
import { buildManageLink, isManageToken } from "../../../lib/publicBookingManage/manageToken.ts";
import { buildBookingConfirmationSms } from "./bookingConfirmationSmsTemplate.ts";

// One SMS confirmation per new public booking, sent after the response to the visitor. Nothing here may change the
// booking: every failure ends in an outcome code. The phone number, message text, link and token are never returned,
// logged or stored; the database only receives the appointment id, an HMAC digest of the number and the outcome.

export type BookingConfirmationSmsConfig = {
  enabled: boolean;
  allowedRecipients: ReadonlySet<string>;
  hashKey: string | null;
  appUrl: string | null;
};

export type BookingConfirmationSmsInput = {
  appointmentId: string;
  salonName: string;
  salonTimezone: string;
  appointmentStart: string;
  recipientE164: string;
  manageToken: string;
};

export type ReserveOutcome = "reserved" | "already_reserved" | "not_eligible" | "salon_disabled" | "recipient_limit" | "salon_limit";
export type SendStatus = "accepted" | "rejected" | "unknown";
export type BookingConfirmationSmsOutcome =
  | "disabled" | "not_allowed" | "misconfigured" | "invalid_input" | "error"
  | Exclude<ReserveOutcome, "reserved"> | SendStatus;

export type BookingConfirmationSmsDependencies = {
  config: BookingConfirmationSmsConfig;
  hmac(key: string, value: string): string;
  reserve(appointmentId: string, recipientHash: string): Promise<string>;
  finish(input: { appointmentId: string; status: SendStatus; provider: string; providerMessageId: string | null; errorCode: string | null }): Promise<boolean>;
  provider: SmsProvider;
};

const MIN_HASH_KEY_LENGTH = 32;
const SAFE_ERROR_CODE = /^[A-Za-z0-9_.-]{1,64}$/;

// accepted: the provider took the message; rejected: it certainly did not; unknown: timeout, network, ambiguous answer.
export function classifySmsResult(result: SmsSendResult): { status: SendStatus; providerMessageId: string | null; errorCode: string | null } {
  if (result.outcome === "accepted") return { status: "accepted", providerMessageId: result.providerMessageId, errorCode: null };
  const errorCode = result.errorCode && SAFE_ERROR_CODE.test(result.errorCode) ? result.errorCode : result.httpStatus ? `HTTP_${result.httpStatus}` : null;
  return { status: result.acceptanceCertainty === "not_accepted" ? "rejected" : "unknown", providerMessageId: null, errorCode };
}

export async function sendBookingConfirmationSmsCore(
  input: BookingConfirmationSmsInput,
  dependencies: BookingConfirmationSmsDependencies,
): Promise<{ outcome: BookingConfirmationSmsOutcome; errorCode?: string | null }> {
  const { config } = dependencies;
  if (!config.enabled) return { outcome: "disabled" };
  // Pilot: only the exact numbers on the team list ever receive a confirmation.
  if (!config.allowedRecipients.has(input.recipientE164)) return { outcome: "not_allowed" };
  if (!config.hashKey || config.hashKey.length < MIN_HASH_KEY_LENGTH || !config.appUrl || !/^https?:\/\/[^/]+$/.test(config.appUrl)) {
    return { outcome: "misconfigured" };
  }
  if (!isManageToken(input.manageToken) || !/^\+[1-9]\d{7,14}$/.test(input.recipientE164)) return { outcome: "invalid_input" };

  let reserved: string;
  try {
    reserved = await dependencies.reserve(input.appointmentId, dependencies.hmac(config.hashKey, input.recipientE164));
  } catch {
    return { outcome: "error", errorCode: "RESERVE_FAILED" };
  }
  if (reserved !== "reserved") {
    const known: ReserveOutcome[] = ["already_reserved", "not_eligible", "salon_disabled", "recipient_limit", "salon_limit"];
    return known.includes(reserved as ReserveOutcome) ? { outcome: reserved as Exclude<ReserveOutcome, "reserved"> } : { outcome: "error", errorCode: "RESERVE_UNEXPECTED" };
  }

  // From here the single attempt is used up: whatever happens, there is no retry.
  let classified: ReturnType<typeof classifySmsResult>;
  try {
    const text = buildBookingConfirmationSms({
      salonName: input.salonName,
      appointmentStart: input.appointmentStart,
      salonTimezone: input.salonTimezone,
      manageLink: buildManageLink(config.appUrl, input.manageToken),
    });
    classified = classifySmsResult(await dependencies.provider.send({ recipient: input.recipientE164, text, clientReference: input.appointmentId }));
  } catch {
    classified = { status: "unknown", providerMessageId: null, errorCode: "SEND_EXCEPTION" };
  }

  let finishErrorCode: string | null = null;
  try {
    if (!await dependencies.finish({ appointmentId: input.appointmentId, provider: "infobip", ...classified })) finishErrorCode = "FINISH_NOT_APPLIED";
  } catch {
    finishErrorCode = "FINISH_FAILED";
  }
  return { outcome: classified.status, errorCode: finishErrorCode ?? classified.errorCode };
}
