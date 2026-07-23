import { NextResponse } from "next/server";
import { z } from "zod";

import { supabaseServer } from "@/lib/supabaseServer";
import { getAuthenticatedRequestUser } from "@/lib/server/requestAuth";

const acceptInvitationSchema = z
  .object({ invitationId: z.string().uuid() })
  .strict();

const SAFE_ERROR_CODES = new Set([
  "UNAUTHORIZED",
  "INVALID_INVITATION",
  "INVITATION_ALREADY_ACCEPTED",
  "EMAIL_MISMATCH",
  "EMPLOYEE_NOT_FOUND",
  "EMPLOYEE_ALREADY_LINKED",
  "PROFILE_ALREADY_LINKED",
  "MEMBERSHIP_CONFLICT",
  "ROLE_CONFLICT",
]);

function responseError(code: string, message: string, status: number) {
  return NextResponse.json({ success: false, code, message }, { status });
}

function getRpcErrorCode(error: unknown) {
  if (!error || typeof error !== "object" || !("message" in error)) return null;
  const message = typeof error.message === "string" ? error.message : "";
  return SAFE_ERROR_CODES.has(message) ? message : null;
}

export async function POST(request: Request) {
  const authResult = await getAuthenticatedRequestUser(request);
  if (!authResult.ok) {
    return responseError("UNAUTHORIZED", "Sesija nije dostupna.", 401);
  }
  const { user } = authResult;
  if (!user.email) {
    return responseError("UNAUTHORIZED", "Sesija nije važeća.", 401);
  }

  const body = await request.json().catch(() => null);
  const parsed = acceptInvitationSchema.safeParse(body);
  if (!parsed.success) {
    return responseError("INVALID_INVITATION", "Poziv nije validan.", 400);
  }

  const { data, error } = await supabaseServer.rpc("accept_team_invitation", {
    p_invitation_id: parsed.data.invitationId,
    p_profile_id: user.id,
  });

  if (error) {
    const code = getRpcErrorCode(error);
    const conflictCodes = new Set([
      "INVITATION_ALREADY_ACCEPTED",
      "EMPLOYEE_ALREADY_LINKED",
      "PROFILE_ALREADY_LINKED",
      "MEMBERSHIP_CONFLICT",
      "ROLE_CONFLICT",
    ]);

    if (code === "EMAIL_MISMATCH") {
      return responseError(code, "Poziv pripada drugom email nalogu.", 403);
    }
    if (code === "INVALID_INVITATION" || code === "EMPLOYEE_NOT_FOUND") {
      return responseError(code, "Poziv ili zaposleni nisu pronađeni.", 404);
    }
    if (code && conflictCodes.has(code)) {
      return responseError(code, "Nalog nije moguće povezati sa ovim zaposlenim.", 409);
    }

    console.error("Accept invitation RPC failed", { code: error.code });
    return responseError("ACCEPT_FAILED", "Poziv trenutno nije moguće prihvatiti.", 500);
  }

  const result = Array.isArray(data) ? data[0] : data;
  if (!result) {
    return responseError("ACCEPT_FAILED", "Poziv trenutno nije moguće prihvatiti.", 500);
  }

  if (result.result_status === "expired") {
    return responseError("INVITATION_EXPIRED", "Poziv je istekao.", 410);
  }
  if (result.result_status === "revoked") {
    return responseError("INVITATION_REVOKED", "Poziv je opozvan.", 410);
  }

  return NextResponse.json({
    success: true,
    status: "accepted",
    alreadyAccepted: Boolean(result.already_accepted),
  });
}
