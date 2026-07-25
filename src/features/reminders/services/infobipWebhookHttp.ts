import { timingSafeEqual } from "node:crypto";

export const INFOBIP_WEBHOOK_BODY_LIMIT_BYTES = 256 * 1024;

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function verifyInfobipWebhookBasicAuth(input: {
  authorization: string | null;
  expectedUsername?: string;
  expectedPassword?: string;
}) {
  if (!input.expectedUsername || !input.expectedPassword || !input.authorization) return false;
  const expected = `Basic ${Buffer.from(`${input.expectedUsername}:${input.expectedPassword}`).toString("base64")}`;
  return safeEqual(input.authorization, expected);
}

export async function readRequestBodyWithLimit(request: Request, maxBytes = INFOBIP_WEBHOOK_BODY_LIMIT_BYTES) {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) return { ok: false as const, code: "BODY_TOO_LARGE" as const };
  if (!request.body) return { ok: true as const, text: "" };

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return { ok: false as const, code: "BODY_TOO_LARGE" as const };
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return { ok: true as const, text };
}
