import "server-only";
import { supabaseServer } from "@/lib/supabaseServer";
import type {
  InfobipDeliveryReportApplyOutcome,
  InfobipDeliveryReportItem,
} from "../types/infobipDeliveryReport";

const ALLOWED_OUTCOMES = new Set<InfobipDeliveryReportApplyOutcome>([
  "updated", "ignored_unknown_message", "ignored_stale", "ignored_duplicate", "ignored_monotone",
]);
const CONFIRMATION_OUTCOMES = new Set<InfobipDeliveryReportApplyOutcome>([
  "updated", "ignored_stale", "ignored_duplicate", "ignored_monotone", "deferred_unknown_message",
]);

function reportArgs(item: InfobipDeliveryReportItem, receivedAt: string) {
  return {
    p_provider_message_id: item.providerMessageId,
    p_status_id: item.statusId,
    p_status_group: item.statusGroup,
    p_status_name: item.statusName,
    p_error_code: item.errorCode,
    p_error_name: item.errorName,
    p_error_permanent: item.errorPermanent,
    p_provider_done_at: item.providerDoneAt,
    p_received_at: receivedAt,
  };
}

// Reminder deliveries first (unchanged); a messageId they do not know may belong to a booking-confirmation SMS.
export async function applyInfobipDeliveryReport(item: InfobipDeliveryReportItem): Promise<InfobipDeliveryReportApplyOutcome> {
  const receivedAt = new Date().toISOString();
  const { data, error } = await supabaseServer.rpc("apply_infobip_sms_delivery_report", reportArgs(item, receivedAt));
  if (error || typeof data !== "string" || !ALLOWED_OUTCOMES.has(data as InfobipDeliveryReportApplyOutcome)) {
    throw new Error("INFOBIP_DELIVERY_REPORT_APPLY_FAILED");
  }
  if (data !== "ignored_unknown_message") return data as InfobipDeliveryReportApplyOutcome;

  const confirmation = await supabaseServer.rpc("apply_confirmation_sms_delivery_report_v1", reportArgs(item, receivedAt));
  if (confirmation.error || typeof confirmation.data !== "string" || !CONFIRMATION_OUTCOMES.has(confirmation.data as InfobipDeliveryReportApplyOutcome)) {
    throw new Error("INFOBIP_DELIVERY_REPORT_APPLY_FAILED");
  }
  return confirmation.data as InfobipDeliveryReportApplyOutcome;
}
