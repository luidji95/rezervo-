import { supabaseServer } from "@/lib/supabaseServer";
import { invalidManageLinkResponse, manageJson, readManageTokenHash } from "@/lib/publicBookingManage/manageResponse.server";

export const dynamic = "force-dynamic";

// Token, deadline, status and the cancellation itself (with the salon notification) are checked and written in one
// locked transaction in the database, so a repeated or concurrent click cancels and notifies exactly once.
export async function POST(request: Request) {
  const tokenHash = await readManageTokenHash(request);
  if (!tokenHash) return invalidManageLinkResponse();

  const { data, error } = await supabaseServer.rpc("cancel_public_booking_by_manage_token_v1", { p_token_hash: tokenHash });
  if (error) {
    console.error("PUBLIC_BOOKING_MANAGE_CANCEL_FAILED", { code: error.code ?? null });
    return manageJson({ success: false, code: "CANCEL_UNAVAILABLE", error: "Please try again." }, 503);
  }
  const row = (data as { outcome: string; salon_phone: string | null }[] | null)?.[0];

  switch (row?.outcome) {
    case "cancelled":
    case "already_cancelled":
      return manageJson({ success: true, outcome: row.outcome });
    case "too_late":
      return manageJson({ success: false, code: "CANCELLATION_TOO_LATE", error: "Online cancellation is closed.", salonPhone: row.salon_phone }, 409);
    case "not_cancellable":
      return manageJson({ success: false, code: "NOT_CANCELLABLE", error: "This appointment cannot be cancelled online.", salonPhone: row.salon_phone }, 409);
    default:
      return invalidManageLinkResponse();
  }
}
