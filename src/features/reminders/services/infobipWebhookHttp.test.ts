import assert from "node:assert/strict";
import test from "node:test";
import { readRequestBodyWithLimit, verifyInfobipWebhookBasicAuth } from "./infobipWebhookHttp.ts";

function basic(username: string, password: string) {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

test("Basic authentication rejects missing or wrong credentials and accepts exact credentials", () => {
  const expected = { expectedUsername: "webhook-user", expectedPassword: "webhook-password" };
  assert.equal(verifyInfobipWebhookBasicAuth({ ...expected, authorization: null }), false);
  assert.equal(verifyInfobipWebhookBasicAuth({ ...expected, authorization: basic("wrong", "webhook-password") }), false);
  assert.equal(verifyInfobipWebhookBasicAuth({ ...expected, authorization: basic("webhook-user", "wrong") }), false);
  assert.equal(verifyInfobipWebhookBasicAuth({ ...expected, authorization: basic("webhook-user", "webhook-password") }), true);
  assert.equal(verifyInfobipWebhookBasicAuth({ authorization: basic("webhook-user", "webhook-password") }), false);
});

test("body reader accepts bounded JSON and rejects declared or streamed oversized bodies", async () => {
  const accepted = await readRequestBodyWithLimit(new Request("https://example.test", { method: "POST", body: "{}" }), 10);
  assert.deepEqual(accepted, { ok: true, text: "{}" });
  const declared = await readRequestBodyWithLimit(new Request("https://example.test", {
    method: "POST", body: "{}", headers: { "Content-Length": "11" },
  }), 10);
  assert.deepEqual(declared, { ok: false, code: "BODY_TOO_LARGE" });
  const streamed = await readRequestBodyWithLimit(new Request("https://example.test", { method: "POST", body: "12345678901" }), 10);
  assert.deepEqual(streamed, { ok: false, code: "BODY_TOO_LARGE" });
});
