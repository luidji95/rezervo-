export type SmsSendInput = {
  recipient: string;
  text: string;
  clientReference?: string;
};

export type SmsAcceptedResult = {
  outcome: "accepted";
  provider: "infobip";
  providerMessageId: string;
  providerStatusGroup?: string;
  providerStatusName?: string;
  httpStatus: number;
};

export type SmsErrorResult = {
  outcome: "retryable_error" | "permanent_error";
  provider: "infobip";
  acceptanceCertainty: "not_accepted" | "unknown";
  httpStatus?: number;
  errorCode?: string;
  safeMessage: string;
  retryAfterSeconds?: number;
};

export type SmsSendResult = SmsAcceptedResult | SmsErrorResult;

export interface SmsProvider {
  send(input: SmsSendInput): Promise<SmsSendResult>;
}
