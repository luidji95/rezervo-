import { NextResponse } from "next/server";
import { z } from "zod";

import { supabaseServer } from "@/lib/supabaseServer";
import { getAuthenticatedRequestUser } from "@/lib/server/requestAuth";
import { emailSchema } from "@/lib/validation/commonSchemas";

const inviteEmployeeSchema = z
  .object({
    salonId: z.string().uuid(),
    employeeId: z.string().uuid(),
    email: emailSchema,
  })
  .strict();

type InviteErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "INVALID_INPUT"
  | "SALON_NOT_FOUND"
  | "EMPLOYEE_NOT_FOUND"
  | "EMPLOYEE_ALREADY_LINKED"
  | "ALREADY_INVITED"
  | "ALREADY_MEMBER"
  | "EMAIL_ALREADY_USED"
  | "INVITE_FAILED";

function errorResponse(
  code: InviteErrorCode,
  message: string,
  status: number,
) {
  return NextResponse.json({ success: false, code, message }, { status });
}

function getRedirectUrl(request: Request) {
  const configuredUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.SITE_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null);

  if (configuredUrl) {
    return new URL("/auth/accept-invite", configuredUrl).toString();
  }

  if (process.env.NODE_ENV === "development") {
    return new URL("/auth/accept-invite", request.url).toString();
  }

  throw new Error("Missing application URL for invitation redirect.");
}

function isUniqueViolation(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "23505",
  );
}

function isExistingAuthEmailError(error: unknown) {
  if (!error || typeof error !== "object") return false;

  const code = "code" in error && typeof error.code === "string" ? error.code : "";
  const message =
    "message" in error && typeof error.message === "string"
      ? error.message.toLowerCase()
      : "";

  return (
    code === "email_exists" ||
    code === "user_already_exists" ||
    message.includes("already been registered") ||
    message.includes("already registered")
  );
}

export async function POST(request: Request) {
  const authResult = await getAuthenticatedRequestUser(request);
  if (!authResult.ok) {
    return errorResponse("UNAUTHORIZED", "Prijava je obavezna.", 401);
  }
  const caller = authResult.user;

  const body = await request.json().catch(() => null);
  const parsed = inviteEmployeeSchema.safeParse(body);

  if (!parsed.success) {
    return errorResponse("INVALID_INPUT", "Podaci poziva nisu ispravni.", 400);
  }

  const { salonId, employeeId, email } = parsed.data;

  try {
    const { data: salon, error: salonError } = await supabaseServer
      .from("salons")
      .select("id, owner_id")
      .eq("id", salonId)
      .maybeSingle();

    if (salonError) throw salonError;
    if (!salon) {
      return errorResponse("SALON_NOT_FOUND", "Salon nije pronađen.", 404);
    }

    const { data: ownerMembership, error: ownerMembershipError } =
      await supabaseServer
        .from("salon_members")
        .select("id")
        .eq("salon_id", salonId)
        .eq("profile_id", caller.id)
        .eq("role", "owner")
        .eq("status", "active")
        .maybeSingle();

    if (ownerMembershipError) throw ownerMembershipError;

    if (salon.owner_id !== caller.id && !ownerMembership) {
      return errorResponse(
        "FORBIDDEN",
        "Samo vlasnik salona može poslati poziv.",
        403,
      );
    }

    const { data: employee, error: employeeError } = await supabaseServer
      .from("employees")
      .select("id, profile_id, is_active")
      .eq("id", employeeId)
      .eq("salon_id", salonId)
      .maybeSingle();

    if (employeeError) throw employeeError;
    if (!employee || !employee.is_active) {
      return errorResponse(
        "EMPLOYEE_NOT_FOUND",
        "Aktivan zaposleni nije pronađen.",
        404,
      );
    }

    if (employee.profile_id) {
      return errorResponse(
        "EMPLOYEE_ALREADY_LINKED",
        "Zaposleni je već povezan sa nalogom.",
        409,
      );
    }

    const { data: existingInvitation, error: invitationLookupError } =
      await supabaseServer
        .from("team_invitations")
        .select("id, expires_at")
        .eq("salon_id", salonId)
        .eq("status", "invited")
        .or(`employee_id.eq.${employeeId},email.eq.${email}`)
        .limit(1)
        .maybeSingle();

    if (invitationLookupError) throw invitationLookupError;
    if (existingInvitation) {
      if (new Date(existingInvitation.expires_at).getTime() > Date.now()) {
        return errorResponse(
          "ALREADY_INVITED",
          "Aktivan poziv već postoji.",
          409,
        );
      }

      const { error: expireError } = await supabaseServer
        .from("team_invitations")
        .update({ status: "expired" })
        .eq("id", existingInvitation.id)
        .eq("status", "invited");

      if (expireError) throw expireError;
    }

    const { data: existingProfile, error: profileError } = await supabaseServer
      .from("profiles")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (profileError) throw profileError;

    if (existingProfile) {
      const { data: existingMembership, error: membershipError } =
        await supabaseServer
          .from("salon_members")
          .select("status, role")
          .eq("salon_id", salonId)
          .eq("profile_id", existingProfile.id)
          .maybeSingle();

      if (membershipError) throw membershipError;
      if (existingMembership?.status === "active") {
        return errorResponse(
          "ALREADY_MEMBER",
          "Korisnik je već član ovog salona.",
          409,
        );
      }
      if (existingMembership?.status === "invited") {
        return errorResponse("ALREADY_INVITED", "Poziv već postoji.", 409);
      }

      return errorResponse(
        "EMAIL_ALREADY_USED",
        "Email je već povezan sa postojećim nalogom.",
        409,
      );
    }

    const redirectTo = getRedirectUrl(request);
    const invitationId = crypto.randomUUID();
    const { error: insertError } = await supabaseServer
      .from("team_invitations")
      .insert({
        id: invitationId,
        salon_id: salonId,
        employee_id: employeeId,
        invited_by: caller.id,
        email,
        status: "invited",
      });

    if (insertError) {
      if (isUniqueViolation(insertError)) {
        return errorResponse(
          "ALREADY_INVITED",
          "Aktivan poziv već postoji.",
          409,
        );
      }
      throw insertError;
    }

    const { data: inviteData, error: inviteError } =
      await supabaseServer.auth.admin.inviteUserByEmail(email, {
        redirectTo,
        data: {
          invitation_id: invitationId,
          salon_id: salonId,
          employee_id: employeeId,
        },
      });

    if (inviteError || !inviteData.user) {
      await supabaseServer
        .from("team_invitations")
        .delete()
        .eq("id", invitationId)
        .eq("status", "invited");

      return isExistingAuthEmailError(inviteError)
        ? errorResponse(
            "EMAIL_ALREADY_USED",
            "Email je već povezan sa postojećim nalogom.",
            409,
          )
        : errorResponse(
            "INVITE_FAILED",
            "Poziv trenutno nije moguće poslati.",
            500,
          );
    }

    const { error: updateError } = await supabaseServer
      .from("team_invitations")
      .update({ auth_user_id: inviteData.user.id })
      .eq("id", invitationId)
      .eq("status", "invited");

    if (updateError) {
      console.error("Invitation auth user context update failed", {
        invitationId,
        code: updateError.code,
      });
    }

    return NextResponse.json(
      { success: true, invitationId, status: "invited" },
      { status: 201 },
    );
  } catch (error) {
    console.error("Employee invitation failed", {
      code:
        error && typeof error === "object" && "code" in error
          ? error.code
          : undefined,
    });
    return errorResponse(
      "INVITE_FAILED",
      "Poziv trenutno nije moguće poslati.",
      500,
    );
  }
}
