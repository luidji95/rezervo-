import type {
  InfobipDeliveryReportItem,
  InfobipDeliveryReportParseResult,
} from "../types/infobipDeliveryReport.ts";

export const MAX_INFOBIP_DELIVERY_RESULTS = 100;
const MAX_MESSAGE_ID_LENGTH = 256;
const MAX_PROVIDER_FIELD_LENGTH = 128;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function optionalInteger(value: unknown) {
  return value === undefined || value === null
    ? null
    : Number.isInteger(value) ? value as number : undefined;
}

function optionalBoolean(value: unknown) {
  return value === undefined || value === null
    ? null
    : typeof value === "boolean" ? value : undefined;
}

function optionalString(value: unknown) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_PROVIDER_FIELD_LENGTH) return undefined;
  return normalized;
}

function parseItem(value: unknown): InfobipDeliveryReportItem | null {
  if (!isRecord(value) || !isRecord(value.status)) return null;
  if (typeof value.messageId !== "string") return null;
  const providerMessageId = value.messageId.trim();
  if (!providerMessageId || providerMessageId.length > MAX_MESSAGE_ID_LENGTH) return null;

  const statusGroup = optionalString(value.status.groupName);
  const statusName = optionalString(value.status.name);
  const statusId = optionalInteger(value.status.id);
  if (!statusGroup || statusName === undefined || statusId === undefined) return null;

  let errorCode: string | null = null;
  let errorName: string | null = null;
  let errorPermanent: boolean | null = null;
  if (value.error !== undefined && value.error !== null) {
    if (!isRecord(value.error)) return null;
    const parsedErrorId = value.error.id === undefined || value.error.id === null
      ? null
      : typeof value.error.id === "number" && Number.isInteger(value.error.id)
        ? String(value.error.id)
        : typeof value.error.id === "string" && value.error.id.trim().length <= MAX_PROVIDER_FIELD_LENGTH
          ? value.error.id.trim()
          : undefined;
    const parsedErrorName = optionalString(value.error.name);
    const parsedPermanent = optionalBoolean(value.error.permanent);
    if (parsedErrorId === undefined || parsedErrorName === undefined || parsedPermanent === undefined) return null;
    errorCode = parsedErrorId;
    errorName = parsedErrorName;
    errorPermanent = parsedPermanent;
  }

  let providerDoneAt: string | null = null;
  if (value.doneAt !== undefined && value.doneAt !== null) {
    if (typeof value.doneAt !== "string" || value.doneAt.length > 64) return null;
    const parsedDate = new Date(value.doneAt);
    if (Number.isNaN(parsedDate.getTime())) return null;
    providerDoneAt = parsedDate.toISOString();
  }

  return {
    providerMessageId,
    statusId,
    statusGroup: statusGroup.toUpperCase(),
    statusName,
    errorCode,
    errorName,
    errorPermanent,
    providerDoneAt,
  };
}

export function parseInfobipSmsDeliveryReport(input: unknown): InfobipDeliveryReportParseResult {
  if (!isRecord(input) || !Array.isArray(input.results)) return { ok: false, code: "INVALID_PAYLOAD" };
  if (input.results.length > MAX_INFOBIP_DELIVERY_RESULTS) return { ok: false, code: "BATCH_TOO_LARGE" };

  const items: InfobipDeliveryReportItem[] = [];
  let invalid = 0;
  for (const result of input.results) {
    const item = parseItem(result);
    if (item) items.push(item);
    else invalid += 1;
  }
  return { ok: true, received: input.results.length, invalid, items };
}
