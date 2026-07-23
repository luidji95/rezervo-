import { NextResponse } from "next/server";
import { z } from "zod";

import { supabaseServer } from "@/lib/supabaseServer";
import { getAuthenticatedRequestUser } from "@/lib/server/requestAuth";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ success: false, code, message }, { status });
}

function logQueryResult(
  stage: string,
  error: {
    code?: string | null;
    message?: string | null;
    details?: string | null;
    hint?: string | null;
  } | null,
  rowCount?: number,
) {
  if (process.env.NODE_ENV !== "development") return;
  console.info("TEAM_INVITATIONS_QUERY", {
    stage,
    success: !error,
    errorCode: error?.code ?? null,
    message: error?.message ?? null,
    details: error?.details ?? null,
    hint: error?.hint ?? null,
    rowCount: rowCount ?? null,
  });
}

export async function GET(request: Request) {
  const parsedSalonId = z
    .string()
    .uuid()
    .safeParse(new URL(request.url).searchParams.get("salonId"));
  if (!parsedSalonId.success) {
    return errorResponse("INVALID_INPUT", "Salon nije naveden.", 400);
  }
  const salonId = parsedSalonId.data;

  const authResult = await getAuthenticatedRequestUser(request);
  if (process.env.NODE_ENV === "development") {
    const diagnostics = authResult.diagnostics;
    console.info("TEAM_INVITATIONS_AUTH_RESULT", {
      hasHeader: diagnostics.hasHeader,
      hasToken: diagnostics.hasToken,
      subjectPresent: diagnostics.subjectPresent,
      expiresAt: diagnostics.expiresAt,
      tokenExpired: diagnostics.tokenExpired,
      issuer: diagnostics.issuer,
      tokenProjectRef: diagnostics.tokenProjectRef,
      expectedProjectRef: diagnostics.expectedProjectRef,
      issuerMatchesProject: diagnostics.issuerMatchesProject,
      audience: diagnostics.audience,
      serverKeyPresent: diagnostics.serverKeyPresent,
      serverKeyRole: diagnostics.serverKeyRole,
      authUserFound: authResult.ok,
      authErrorCode: authResult.ok ? null : authResult.errorCode,
      authErrorMessagePresent: authResult.ok
        ? false
        : authResult.errorMessagePresent,
    });
  }

  if (!authResult.ok) {
    return errorResponse("UNAUTHORIZED", "Sesija nije važeća.", 401);
  }
  const { user } = authResult;
  if (process.env.NODE_ENV === "development") {
    console.info("TEAM_INVITATIONS_CALLER", { authenticated: true });
  }

  const { data: salon, error: salonError } = await supabaseServer
    .from("salons")
    .select("id, owner_id")
    .eq("id", salonId)
    .maybeSingle();

  if (salonError) {
    logQueryResult("salon_lookup", salonError);
    return errorResponse("INVITATIONS_FAILED", "Pozive nije moguće učitati.", 500);
  }
  logQueryResult("salon_lookup", null, salon ? 1 : 0);
  if (!salon) return errorResponse("SALON_NOT_FOUND", "Salon nije pronađen.", 404);

  const { data: ownerMembership, error: membershipError } = await supabaseServer
    .from("salon_members")
    .select("id")
    .eq("salon_id", salonId)
    .eq("profile_id", user.id)
    .eq("role", "owner")
    .eq("status", "active")
    .maybeSingle();

  if (membershipError) {
    logQueryResult("owner_membership", membershipError);
    return errorResponse("INVITATIONS_FAILED", "Pozive nije moguće učitati.", 500);
  }
  logQueryResult("owner_membership", null, ownerMembership ? 1 : 0);
  if (salon.owner_id !== user.id && !ownerMembership) {
    if (process.env.NODE_ENV === "development") {
      console.info("TEAM_INVITATIONS_OWNER_AUTH", { authorized: false });
    }
    return errorResponse("FORBIDDEN", "Nemate pristup pozivima ovog salona.", 403);
  }
  if (process.env.NODE_ENV === "development") {
    console.info("TEAM_INVITATIONS_OWNER_AUTH", { authorized: true });
  }

  const { data, error } = await supabaseServer
    .from("team_invitations")
    .select("employee_id, email, status, created_at, expires_at")
    .eq("salon_id", salonId)
    .order("created_at", { ascending: false });

  if (error) {
    logQueryResult("invitation_list", error);
    return errorResponse("INVITATIONS_FAILED", "Pozive nije moguće učitati.", 500);
  }
  logQueryResult("invitation_list", null, data?.length ?? 0);

  const now = Date.now();
  return NextResponse.json({
    success: true,
    invitations: (data ?? []).map((invitation) => ({
      employeeId: invitation.employee_id,
      email: invitation.email,
      status:
        invitation.status === "invited" &&
        new Date(invitation.expires_at).getTime() <= now
          ? "expired"
          : invitation.status,
      createdAt: invitation.created_at,
      expiresAt: invitation.expires_at,
    })),
  });
}
