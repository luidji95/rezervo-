import { supabaseServer } from "@/lib/supabaseServer";
import { invalidManageLinkResponse, manageJson, readManageTokenHash } from "@/lib/publicBookingManage/manageResponse.server";

export const dynamic = "force-dynamic";

type ManageBookingRow = {
  salon_name: string;
  salon_slug: string;
  salon_phone: string | null;
  salon_timezone: string;
  service_name: string | null;
  start_time: string;
  end_time: string;
  status: string;
  can_cancel: boolean;
  cancel_deadline: string;
};

// Read-only: opening the link never changes the appointment. POST keeps the token out of URLs and request logs.
export async function POST(request: Request) {
  const tokenHash = await readManageTokenHash(request);
  if (!tokenHash) return invalidManageLinkResponse();

  const { data, error } = await supabaseServer.rpc("get_public_booking_by_manage_token_v1", { p_token_hash: tokenHash });
  if (error) {
    console.error("PUBLIC_BOOKING_MANAGE_VIEW_FAILED", { code: error.code ?? null });
    return manageJson({ success: false, code: "MANAGE_UNAVAILABLE", error: "Please try again." }, 503);
  }
  const row = (data as ManageBookingRow[] | null)?.[0];
  if (!row) return invalidManageLinkResponse();

  return manageJson({
    success: true,
    booking: {
      salonName: row.salon_name,
      salonSlug: row.salon_slug,
      salonPhone: row.salon_phone,
      timeZone: row.salon_timezone,
      serviceName: row.service_name,
      startTime: row.start_time,
      endTime: row.end_time,
      status: row.status,
      canCancel: row.can_cancel,
      cancelDeadline: row.cancel_deadline,
    },
  });
}
