import { createHash } from "node:crypto";

import { parseLemonSqueezyCheckoutId } from "./lemonSqueezyResourceIds.ts";

export function isLemonSqueezyJsonApiContentType(value: string | null): boolean {
  return value?.split(";", 1)[0]?.trim().toLowerCase() === "application/vnd.api+json";
}

export function validateLemonSqueezyCheckoutAccess(input: {
  providerCheckoutId: string;
  checkoutUrl: string;
  providerExpiresAt: string | null;
  now: Date;
}): { checkoutUrlHash: string; providerExpiresAt: string } | null {
  let checkoutId: string;
  try { checkoutId = parseLemonSqueezyCheckoutId(input.providerCheckoutId); }
  catch { return null; }

  const nowMs = input.now.getTime();
  const providerExpiresAt = input.providerExpiresAt;
  if (providerExpiresAt === null) return null;
  const providerExpiryMs = Date.parse(providerExpiresAt);
  if (
    !Number.isFinite(nowMs) ||
    !Number.isFinite(providerExpiryMs) ||
    providerExpiryMs <= nowMs
  ) return null;

  let url: URL;
  try { url = new URL(input.checkoutUrl); }
  catch { return null; }
  const keys = [...url.searchParams.keys()];
  if (
    url.protocol !== "https:" ||
    url.hostname !== "rezervoo.lemonsqueezy.com" ||
    url.port || url.username || url.password || url.hash ||
    url.pathname !== `/checkout/custom/${checkoutId}` ||
    keys.length !== 2 ||
    keys.some((key) => key !== "expires" && key !== "signature") ||
    url.searchParams.getAll("expires").length !== 1 ||
    url.searchParams.getAll("signature").length !== 1
  ) return null;

  const expires = url.searchParams.get("expires");
  const signature = url.searchParams.get("signature");
  if (!expires || !/^[1-9]\d{0,9}$/.test(expires) || !signature?.trim()) return null;
  const expiresSeconds = Number(expires);
  if (!Number.isSafeInteger(expiresSeconds)) return null;
  const urlExpiryMs = expiresSeconds * 1000;
  if (
    !Number.isSafeInteger(urlExpiryMs) ||
    !Number.isFinite(new Date(urlExpiryMs).getTime()) ||
    urlExpiryMs <= nowMs
  ) return null;

  return {
    checkoutUrlHash: createHash("sha256").update(input.checkoutUrl).digest("hex"),
    providerExpiresAt,
  };
}
