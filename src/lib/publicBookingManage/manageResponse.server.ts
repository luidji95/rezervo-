import "server-only";
import { NextResponse } from "next/server";
import { isManageToken } from "./manageToken";
import { hashManageToken } from "./manageTokenHash.server";

// Responses of the manage-link API are private to one visitor: never cached, indexed or passed on as a referrer.
export const MANAGE_RESPONSE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
} as const;

export function manageJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: MANAGE_RESPONSE_HEADERS });
}

// One answer for a malformed token, an unknown token and an appointment that is not a public booking, so an invalid
// link cannot tell whether an appointment exists.
export function invalidManageLinkResponse() {
  return manageJson({ success: false, code: "MANAGE_LINK_INVALID", error: "This link is not valid." }, 404);
}

// Reads { token } from the POST body and returns its digest; the token itself is not kept, returned or logged.
export async function readManageTokenHash(request: Request) {
  const body = await request.json().catch(() => null) as { token?: unknown } | null;
  return isManageToken(body?.token) ? hashManageToken(body.token) : null;
}
