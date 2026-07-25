import type {
  InfobipDeliveryReportApplyOutcome,
  InfobipDeliveryReportItem,
} from "../types/infobipDeliveryReport.ts";

export type InfobipDeliveryReportBatchResult = {
  received: number;
  updated: number;
  ignored: number;
  invalid: number;
};

export type DeliveryReportState = {
  status: "pending" | "processing" | "sent" | "delivered" | "retry_scheduled" | "failed" | "skipped" | "cancelled";
  providerDoneAt: string | null;
};

export function mapInfobipDeliveryTransition(state: DeliveryReportState, item: InfobipDeliveryReportItem) {
  const existingDoneAt = state.providerDoneAt ? new Date(state.providerDoneAt).getTime() : null;
  const incomingDoneAt = item.providerDoneAt ? new Date(item.providerDoneAt).getTime() : null;
  if (existingDoneAt !== null && (incomingDoneAt === null || incomingDoneAt < existingDoneAt)) {
    return { action: "ignored_stale" as const, status: state.status };
  }
  if (state.status === "delivered" && item.statusGroup !== "DELIVERED") {
    return { action: "ignored_monotone" as const, status: state.status };
  }
  if (state.status === "failed" && item.statusGroup === "PENDING") {
    return { action: "ignored_monotone" as const, status: state.status };
  }
  if (item.statusGroup === "DELIVERED") return { action: "updated" as const, status: "delivered" as const };
  if (["UNDELIVERABLE", "EXPIRED", "REJECTED"].includes(item.statusGroup)) {
    return { action: "updated" as const, status: "failed" as const };
  }
  return { action: "updated" as const, status: state.status };
}

export async function processInfobipDeliveryReportBatch(input: {
  received: number;
  invalid: number;
  items: InfobipDeliveryReportItem[];
  apply(item: InfobipDeliveryReportItem): Promise<InfobipDeliveryReportApplyOutcome>;
}): Promise<InfobipDeliveryReportBatchResult> {
  let updated = 0;
  let ignored = input.invalid;
  for (const item of input.items) {
    const outcome = await input.apply(item);
    if (outcome === "updated") updated += 1;
    else ignored += 1;
  }
  return { received: input.received, updated, ignored, invalid: input.invalid };
}
