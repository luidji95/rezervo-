import { supabase } from "@/lib/supabase/client";

export type AcceptInvitationErrorCode =
  | "UNAUTHORIZED"
  | "INVALID_INVITATION"
  | "INVITATION_EXPIRED"
  | "INVITATION_REVOKED"
  | "INVITATION_ALREADY_ACCEPTED"
  | "EMAIL_MISMATCH"
  | "EMPLOYEE_NOT_FOUND"
  | "EMPLOYEE_ALREADY_LINKED"
  | "PROFILE_ALREADY_LINKED"
  | "MEMBERSHIP_CONFLICT"
  | "ROLE_CONFLICT"
  | "ACCEPT_FAILED";

export class AcceptInvitationError extends Error {
  constructor(public readonly code: AcceptInvitationErrorCode) {
    super(code);
    this.name = "AcceptInvitationError";
  }
}

export type TeamInvitationStatus =
  | "invited"
  | "accepted"
  | "expired"
  | "revoked";

export type TeamInvitationSummary = {
  employeeId: string;
  email: string;
  status: TeamInvitationStatus;
  createdAt: string;
  expiresAt: string;
};

export type SendInvitationErrorCode =
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

export class SendInvitationError extends Error {
  constructor(public readonly code: SendInvitationErrorCode) {
    super(code);
    this.name = "SendInvitationError";
  }
}

export class TeamInvitationStatusError extends Error {
  constructor(public readonly code: "UNAUTHORIZED" | "LOAD_FAILED") {
    super(code);
    this.name = "TeamInvitationStatusError";
  }
}

async function getAccessToken() {
  let {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  if (process.env.NODE_ENV === "development") {
    console.info("TEAM_INVITATIONS_SESSION", {
      hasSession: Boolean(session),
      hasAccessToken: Boolean(session?.access_token),
    });
  }

  if (error || !session?.access_token) {
    await supabase.auth.getUser();
    const currentSession = await supabase.auth.getSession();
    session = currentSession.data.session;
    error = currentSession.error;
  }

  return session?.access_token ?? null;
}

async function fetchTeamInvitations(salonId: string, accessToken: string) {
  return fetch(
    `/api/team/invitations?salonId=${encodeURIComponent(salonId)}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    },
  );
}

export async function getTeamInvitations(
  salonId: string,
): Promise<TeamInvitationSummary[]> {
  const accessToken = await getAccessToken();
  if (!accessToken) throw new TeamInvitationStatusError("UNAUTHORIZED");

  let response = await fetchTeamInvitations(salonId, accessToken);

  if (response.status === 401) {
    // getSession() uses Supabase's current, auto-refreshed browser session.
    // Retry only when Auth has actually produced a different access token;
    // this feature request must not force a global refresh/sign-out cycle.
    const latestSession = await supabase.auth.getSession();
    const refreshedToken = latestSession.data.session?.access_token;
    if (refreshedToken && refreshedToken !== accessToken) {
      response = await fetchTeamInvitations(salonId, refreshedToken);
    }
  }

  if (process.env.NODE_ENV === "development") {
    console.info("TEAM_INVITATIONS_RESPONSE", { status: response.status });
  }
  const result = (await response.json().catch(() => null)) as
    | { success: true; invitations: TeamInvitationSummary[] }
    | { success: false; code?: string; message?: string }
    | null;

  if (!response.ok || !result?.success) {
    if (process.env.NODE_ENV === "development") {
      console.error("TEAM_INVITATIONS_LOAD_ERROR", {
        status: response.status,
        code: result && "code" in result ? result.code ?? null : null,
        message: result && "message" in result ? result.message ?? null : null,
      });
    }
    throw new TeamInvitationStatusError(
      response.status === 401 ? "UNAUTHORIZED" : "LOAD_FAILED",
    );
  }

  return result.invitations;
}

export async function sendTeamInvitation(input: {
  salonId: string;
  employeeId: string;
  email: string;
}) {
  const accessToken = await getAccessToken();
  if (!accessToken) throw new SendInvitationError("UNAUTHORIZED");

  const response = await fetch("/api/team/invite", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  const result = (await response.json().catch(() => null)) as
    | { success: true; status: "invited" }
    | { success: false; code?: SendInvitationErrorCode }
    | null;

  if (!response.ok || !result?.success) {
    throw new SendInvitationError(
      result && "code" in result && result.code
        ? result.code
        : "INVITE_FAILED",
    );
  }

  return result;
}

export async function acceptTeamInvitation(invitationId: string) {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    throw new AcceptInvitationError("UNAUTHORIZED");
  }

  const response = await fetch("/api/team/accept-invite", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ invitationId }),
  });
  const result = (await response.json().catch(() => null)) as
    | { success: true; status: "accepted"; alreadyAccepted: boolean }
    | { success: false; code?: AcceptInvitationErrorCode }
    | null;

  if (!response.ok || !result?.success) {
    throw new AcceptInvitationError(
      result && "code" in result && result.code
        ? result.code
        : "ACCEPT_FAILED",
    );
  }

  return result;
}
