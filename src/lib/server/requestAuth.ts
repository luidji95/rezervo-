import "server-only";

import { createClient, type User } from "@supabase/supabase-js";

type JwtPayload = {
  sub?: unknown;
  exp?: unknown;
  iss?: unknown;
  aud?: unknown;
  role?: unknown;
};

export type RequestAuthDiagnostics = {
  hasHeader: boolean;
  hasToken: boolean;
  subjectPresent: boolean;
  expiresAt: number | null;
  tokenExpired: boolean | null;
  issuer: string | null;
  tokenProjectRef: string | null;
  expectedProjectRef: string | null;
  issuerMatchesProject: boolean;
  audience: string | string[] | null;
  serverKeyPresent: boolean;
  serverKeyRole: string | null;
};

export type RequestAuthResult =
  | { ok: true; user: User; diagnostics: RequestAuthDiagnostics }
  | {
      ok: false;
      status: 401;
      code: "UNAUTHORIZED";
      reason: "MISSING_TOKEN" | "INVALID_TOKEN";
      errorCode: string | null;
      errorMessagePresent: boolean;
      diagnostics: RequestAuthDiagnostics;
    };

function decodeJwtPayload(token: string | undefined): JwtPayload | null {
  if (!token) return null;

  try {
    const encodedPayload = token.split(".")[1];
    if (!encodedPayload) return null;
    return JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as JwtPayload;
  } catch {
    return null;
  }
}

function getProjectRef(value: string | undefined) {
  if (!value) return null;
  const match = /^https:\/\/([^.]+)\.supabase\.co(?:\/auth\/v1)?\/?$/.exec(
    value,
  );
  return match?.[1] ?? null;
}

function getDiagnostics(
  authorization: string | null,
  token: string | undefined,
): RequestAuthDiagnostics {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const tokenPayload = decodeJwtPayload(token);
  const serviceKeyPayload = decodeJwtPayload(
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
  const issuer =
    typeof tokenPayload?.iss === "string" ? tokenPayload.iss : null;
  const expiresAt =
    typeof tokenPayload?.exp === "number" ? tokenPayload.exp : null;
  const expectedProjectRef = getProjectRef(supabaseUrl);
  const tokenProjectRef = getProjectRef(issuer ?? undefined);
  const audience =
    typeof tokenPayload?.aud === "string" || Array.isArray(tokenPayload?.aud)
      ? (tokenPayload.aud as string | string[])
      : null;

  return {
    hasHeader: Boolean(authorization),
    hasToken: Boolean(token),
    subjectPresent: typeof tokenPayload?.sub === "string",
    expiresAt,
    tokenExpired: expiresAt === null ? null : expiresAt <= Date.now() / 1000,
    issuer,
    tokenProjectRef,
    expectedProjectRef,
    issuerMatchesProject:
      Boolean(tokenProjectRef) && tokenProjectRef === expectedProjectRef,
    audience,
    serverKeyPresent: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    serverKeyRole:
      typeof serviceKeyPayload?.role === "string"
        ? serviceKeyPayload.role
        : null,
  };
}

export async function getAuthenticatedRequestUser(
  request: Request,
): Promise<RequestAuthResult> {
  const authorization = request.headers.get("authorization");
  const token = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
  const diagnostics = getDiagnostics(authorization, token || undefined);

  if (!token) {
    return {
      ok: false,
      status: 401,
      code: "UNAUTHORIZED",
      reason: "MISSING_TOKEN",
      errorCode: null,
      errorMessagePresent: false,
      diagnostics,
    };
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    return {
      ok: false,
      status: 401,
      code: "UNAUTHORIZED",
      reason: "INVALID_TOKEN",
      errorCode: "AUTH_SERVER_CONFIG_MISSING",
      errorMessagePresent: true,
      diagnostics,
    };
  }

  const requestClient = createClient(supabaseUrl, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: { Authorization: `Bearer ${token}` },
    },
  });

  let result: Awaited<ReturnType<typeof requestClient.auth.getUser>>;
  try {
    result = await requestClient.auth.getUser();
  } catch {
    return {
      ok: false,
      status: 401,
      code: "UNAUTHORIZED",
      reason: "INVALID_TOKEN",
      errorCode: "AUTH_CHECK_FAILED",
      errorMessagePresent: true,
      diagnostics,
    };
  }
  const user = result.data.user;

  if (result.error || !user) {
    return {
      ok: false,
      status: 401,
      code: "UNAUTHORIZED",
      reason: "INVALID_TOKEN",
      errorCode: result.error?.code ?? null,
      errorMessagePresent: Boolean(result.error?.message),
      diagnostics,
    };
  }

  return { ok: true, user, diagnostics };
}
