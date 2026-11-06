// Private link for managing one publicly booked appointment. The token is 32 random bytes (base64url, 43 chars),
// generated in the browser once per booking attempt and sent again with the same idempotency key on a retry, so a
// lost response still ends with the same link. It travels in the URL fragment (/manage-booking#<token>), which the
// browser never sends to the server or in a Referer header; the API receives it only in a POST body.
export const MANAGE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const MANAGE_BOOKING_PATH = "/manage-booking";

export function isManageToken(value: unknown): value is string {
  return typeof value === "string" && MANAGE_TOKEN_PATTERN.test(value);
}

export function createManageToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function buildManageLink(origin: string, token: string) {
  return `${origin}${MANAGE_BOOKING_PATH}#${token}`;
}

export function readManageTokenFromHash(hash: string) {
  const token = hash.replace(/^#/, "");
  return isManageToken(token) ? token : null;
}
