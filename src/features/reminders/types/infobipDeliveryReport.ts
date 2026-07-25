export type InfobipDeliveryReportItem = {
  providerMessageId: string;
  statusId: number | null;
  statusGroup: string;
  statusName: string | null;
  errorCode: string | null;
  errorName: string | null;
  errorPermanent: boolean | null;
  providerDoneAt: string | null;
};

export type InfobipDeliveryReportParseResult =
  | { ok: true; received: number; invalid: number; items: InfobipDeliveryReportItem[] }
  | { ok: false; code: "INVALID_PAYLOAD" | "BATCH_TOO_LARGE" };

export type InfobipDeliveryReportApplyOutcome =
  | "updated"
  | "ignored_unknown_message"
  | "ignored_stale"
  | "ignored_duplicate"
  | "ignored_monotone";
