import "server-only";
import type { SmsProvider } from "../types/smsProvider";
import { createInfobipSmsProviderCore } from "./infobipSmsProviderCore";

export function createInfobipSmsProvider(): SmsProvider {
  return createInfobipSmsProviderCore({
    baseUrl: process.env.INFOBIP_BASE_URL,
    apiKey: process.env.INFOBIP_API_KEY,
    sender: process.env.INFOBIP_SMS_SENDER,
  });
}
