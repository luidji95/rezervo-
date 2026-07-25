import "server-only";
import { supabaseServer } from "@/lib/supabaseServer";
import type {
  InfobipDeliveryReportApplyOutcome,
  InfobipDeliveryReportItem,
} from "../types/infobipDeliveryReport";

const ALLOWED_OUTCOMES = new Set<InfobipDeliveryReportApplyOutcome>([
  "updated", "ignored_unknown_message", "ignored_stale", "ignored_duplicate", "ignored_monotone",
]);

export async function applyInfobipDeliveryReport(item: InfobipDeliveryReportItem): Promise<InfobipDeliveryReportApplyOutcome> {
  const { data, error } = await supabaseServer.rpc("apply_infobip_sms_delivery_report", {
    p_provider_message_id: item.providerMessageId,
    p_status_id: item.statusId,
    p_status_group: item.statusGroup,
    p_status_name: item.statusName,
    p_error_code: item.errorCode,
    p_error_name: item.errorName,
    p_error_permanent: item.errorPermanent,
    p_provider_done_at: item.providerDoneAt,
    p_received_at: new Date().toISOString(),
  });
  if (error || typeof data !== "string" || !ALLOWED_OUTCOMES.has(data as InfobipDeliveryReportApplyOutcome)) {
    throw new Error("INFOBIP_DELIVERY_REPORT_APPLY_FAILED");
  }
  return data as InfobipDeliveryReportApplyOutcome;
}
