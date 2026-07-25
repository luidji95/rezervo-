import type {
  SmsErrorResult,
  SmsProvider,
  SmsSendInput,
  SmsSendResult,
} from "../types/smsProvider.ts";

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_MESSAGE_LENGTH = 4_096;
const INTERNATIONAL_PHONE_PATTERN = /^\+[1-9]\d{7,14}$/;
const EXPLICIT_REJECTION_PATTERN = /REJECT|INVALID|UNDELIVERABLE|EXPIRED|BLOCKED|DEACTIVATED/i;

type InfobipConfig = {
  baseUrl?: string;
  apiKey?: string;
  sender?: string;
};

type InfobipDependencies = {
  fetch?: typeof fetch;
  timeoutMs?: number;
};

type ProviderPayload = {
  messages?: Array<{
    messageId?: unknown;
    status?: {
      groupName?: unknown;
      name?: unknown;
    };
  }>;
  requestError?: {
    serviceException?: {
      messageId?: unknown;
    };
  };
};

function permanentError(
  safeMessage: string,
  details: Pick<SmsErrorResult, "httpStatus" | "errorCode"> = {},
): SmsErrorResult {
  return { outcome: "permanent_error", provider: "infobip", acceptanceCertainty: "not_accepted", safeMessage, ...details };
}

function retryableError(
  safeMessage: string,
  details: Pick<SmsErrorResult, "httpStatus" | "errorCode" | "retryAfterSeconds"> = {},
  acceptanceCertainty: SmsErrorResult["acceptanceCertainty"] = "unknown",
): SmsErrorResult {
  return { outcome: "retryable_error", provider: "infobip", acceptanceCertainty, safeMessage, ...details };
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 128) : undefined;
}

function readErrorCode(payload: ProviderPayload | null) {
  const value = stringValue(payload?.requestError?.serviceException?.messageId);
  return value && /^[A-Za-z0-9_.-]+$/.test(value) ? value : undefined;
}

function parseRetryAfter(value: string | null) {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);

  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.max(0, Math.ceil((date - Date.now()) / 1_000));
  return undefined;
}

async function readPayload(response: Response): Promise<ProviderPayload | null | "invalid_json"> {
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed as ProviderPayload : "invalid_json";
  } catch {
    return "invalid_json";
  }
}

function classifyHttpError(
  response: Response,
  payload: ProviderPayload | null | "invalid_json",
): SmsErrorResult {
  const errorCode = payload === "invalid_json" ? undefined : readErrorCode(payload);
  const details = { httpStatus: response.status, errorCode };

  if (response.status === 408) {
    return retryableError("Infobip zahtev je istekao i može se pokušati ponovo.", details, "not_accepted");
  }
  if (response.status === 429) {
    return retryableError("Infobip ograničenje zahteva je dostignuto; pokušajte ponovo kasnije.", {
      ...details,
      retryAfterSeconds: parseRetryAfter(response.headers.get("Retry-After")),
    }, "not_accepted");
  }
  if (response.status >= 500) {
    return retryableError("Infobip servis je privremeno nedostupan.", details);
  }
  if (response.status === 401 || response.status === 403) {
    return permanentError("Infobip konfiguracija ili dozvole nisu ispravne.", details);
  }
  if (response.status === 400) {
    return permanentError("Infobip je odbio SMS zahtev zbog neispravnog recipienta, sendera ili sadržaja.", details);
  }
  return permanentError("Infobip je trajno odbio SMS zahtev.", details);
}

function validateInput(input: SmsSendInput): SmsErrorResult | null {
  if (!input.recipient.trim()) return permanentError("SMS recipient je obavezan.", { errorCode: "INVALID_RECIPIENT" });
  if (!INTERNATIONAL_PHONE_PATTERN.test(input.recipient.trim())) {
    return permanentError("SMS recipient mora biti u međunarodnom E.164 formatu.", { errorCode: "INVALID_RECIPIENT" });
  }
  if (!input.text.trim()) return permanentError("SMS tekst je obavezan.", { errorCode: "INVALID_MESSAGE" });
  if (input.text.length > MAX_MESSAGE_LENGTH) {
    return permanentError(`SMS tekst prelazi sigurnosni maksimum od ${MAX_MESSAGE_LENGTH} znakova.`, { errorCode: "MESSAGE_TOO_LONG" });
  }
  return null;
}

function normalizeConfig(config: InfobipConfig):
  | { baseUrl: string; apiKey: string; sender: string }
  | SmsErrorResult {
  const baseUrl = config.baseUrl?.trim().replace(/\/+$/, "");
  const apiKey = config.apiKey?.trim();
  const sender = config.sender?.trim();

  if (!baseUrl) return permanentError("INFOBIP_BASE_URL nije konfigurisan.", { errorCode: "PROVIDER_CONFIG_MISSING" });
  if (!apiKey) return permanentError("INFOBIP_API_KEY nije konfigurisan.", { errorCode: "PROVIDER_CONFIG_MISSING" });
  if (!sender) return permanentError("INFOBIP_SMS_SENDER nije konfigurisan.", { errorCode: "PROVIDER_CONFIG_MISSING" });

  try {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== "https:") throw new Error("HTTPS_REQUIRED");
  } catch {
    return permanentError("INFOBIP_BASE_URL mora biti validan HTTPS URL.", { errorCode: "PROVIDER_CONFIG_INVALID" });
  }

  return { baseUrl, apiKey, sender };
}

export function createInfobipSmsProviderCore(
  config: InfobipConfig,
  dependencies: InfobipDependencies = {},
): SmsProvider {
  const fetchImplementation = dependencies.fetch ?? globalThis.fetch;
  const timeoutMs = dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async send(input): Promise<SmsSendResult> {
      const inputError = validateInput(input);
      if (inputError) return inputError;

      const normalizedConfig = normalizeConfig(config);
      if ("outcome" in normalizedConfig) return normalizedConfig;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetchImplementation(`${normalizedConfig.baseUrl}/sms/3/messages`, {
          method: "POST",
          headers: {
            Authorization: `App ${normalizedConfig.apiKey}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            messages: [{
              destinations: [{ to: input.recipient.trim() }],
              sender: normalizedConfig.sender,
              content: { text: input.text },
            }],
          }),
          signal: controller.signal,
        });

        const payload = await readPayload(response);
        if (!response.ok) return classifyHttpError(response, payload);
        if (payload === "invalid_json" || !payload) {
          return retryableError("Infobip je vratio nevažeći ili prazan uspešan odgovor; status prihvatanja nije poznat.", { httpStatus: response.status, errorCode: "AMBIGUOUS_PROVIDER_RESPONSE" });
        }

        const message = payload.messages?.[0];
        const providerMessageId = stringValue(message?.messageId);
        const providerStatusGroup = stringValue(message?.status?.groupName);
        const providerStatusName = stringValue(message?.status?.name);
        if (!providerMessageId) {
          return retryableError("Infobip uspešan odgovor nema message ID; status prihvatanja nije poznat.", { httpStatus: response.status, errorCode: "AMBIGUOUS_PROVIDER_RESPONSE" });
        }

        if (EXPLICIT_REJECTION_PATTERN.test(`${providerStatusGroup ?? ""} ${providerStatusName ?? ""}`)) {
          return permanentError("Infobip je eksplicitno odbio SMS poruku.", { httpStatus: response.status, errorCode: providerStatusName ?? providerStatusGroup ?? "PROVIDER_REJECTED" });
        }

        return {
          outcome: "accepted",
          provider: "infobip",
          providerMessageId,
          providerStatusGroup,
          providerStatusName,
          httpStatus: response.status,
        };
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          return retryableError("Infobip zahtev je istekao i može se pokušati ponovo.", { errorCode: "PROVIDER_TIMEOUT" });
        }
        return retryableError("Mrežna greška pri pozivu Infobip servisa.", { errorCode: "PROVIDER_NETWORK_ERROR" });
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
