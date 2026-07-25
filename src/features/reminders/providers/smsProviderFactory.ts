import "server-only";
import type { SmsProvider } from "../types/smsProvider";
import { createInfobipSmsProvider } from "./infobipSmsProvider";

export function getSmsProvider(): SmsProvider {
  return createInfobipSmsProvider();
}
