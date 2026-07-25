import assert from "node:assert/strict";
import test from "node:test";
import { createInfobipSmsProviderCore } from "./infobipSmsProviderCore.ts";

const config = {
  baseUrl: "https://trial.api.infobip.com/",
  apiKey: "super-secret-key",
  sender: "Rezervo",
};
const input = { recipient: "+381641234567", text: "Test message", clientReference: "delivery-123" };

function jsonResponse(payload: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function providerWithResponse(response: Response) {
  return createInfobipSmsProviderCore(config, { fetch: async () => response });
}

test("maps PENDING_ACCEPTED response to provider-neutral accepted result", async () => {
  let requestedUrl = "";
  let requestInit: RequestInit | undefined;
  const provider = createInfobipSmsProviderCore(config, {
    fetch: async (url, init) => {
      requestedUrl = String(url);
      requestInit = init;
      return jsonResponse({ messages: [{ messageId: "msg-123", status: { groupName: "PENDING", name: "PENDING_ACCEPTED" } }] });
    },
  });

  const result = await provider.send(input);
  assert.deepEqual(result, {
    outcome: "accepted",
    provider: "infobip",
    providerMessageId: "msg-123",
    providerStatusGroup: "PENDING",
    providerStatusName: "PENDING_ACCEPTED",
    httpStatus: 200,
  });
  assert.equal(requestedUrl, "https://trial.api.infobip.com/sms/3/messages");
  assert.equal(new Headers(requestInit?.headers).get("Authorization"), "App super-secret-key");
  const body = JSON.parse(String(requestInit?.body));
  assert.equal(body.messages.length, 1);
  assert.deepEqual(body.messages[0], {
    destinations: [{ to: input.recipient }],
    sender: config.sender,
    content: { text: input.text },
  });
  assert.equal(JSON.stringify(body).includes("delivery-123"), false);
});

test("rejects invalid input before fetch", async () => {
  let calls = 0;
  const provider = createInfobipSmsProviderCore(config, { fetch: async () => { calls += 1; return new Response(); } });
  for (const invalidInput of [
    { recipient: "", text: "Test" },
    { recipient: "0641234567", text: "Test" },
    { recipient: "+381641234567", text: "" },
    { recipient: "+381641234567", text: "x".repeat(4_097) },
  ]) {
    assert.equal((await provider.send(invalidInput)).outcome, "permanent_error");
  }
  assert.equal(calls, 0);
});

test("rejects missing or invalid provider configuration before fetch", async () => {
  let calls = 0;
  const fetchMock = async () => { calls += 1; return new Response(); };
  for (const invalidConfig of [
    { ...config, baseUrl: "" },
    { ...config, apiKey: "" },
    { ...config, sender: "" },
    { ...config, baseUrl: "http://trial.api.infobip.com" },
  ]) {
    const result = await createInfobipSmsProviderCore(invalidConfig, { fetch: fetchMock }).send(input);
    assert.equal(result.outcome, "permanent_error");
  }
  assert.equal(calls, 0);
});

test("classifies network failure and timeout as retryable", async () => {
  const networkProvider = createInfobipSmsProviderCore(config, {
    fetch: async () => { throw new TypeError("network failed"); },
  });
  assert.equal((await networkProvider.send(input)).outcome, "retryable_error");

  const timeoutProvider = createInfobipSmsProviderCore(config, {
    timeoutMs: 5,
    fetch: async (_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }),
  });
  const timeoutResult = await timeoutProvider.send(input);
  assert.equal(timeoutResult.outcome, "retryable_error");
  assert.equal(timeoutResult.errorCode, "PROVIDER_TIMEOUT");
});

test("classifies 408, 429 and 5xx as retryable", async () => {
  for (const status of [408, 500, 503]) {
    const result = await providerWithResponse(jsonResponse({}, status)).send(input);
    assert.equal(result.outcome, "retryable_error");
    assert.equal(result.httpStatus, status);
  }

  const rateLimited = await providerWithResponse(jsonResponse({}, 429, { "Retry-After": "42" })).send(input);
  assert.equal(rateLimited.outcome, "retryable_error");
  assert.equal(rateLimited.retryAfterSeconds, 42);
});

test("treats invalid, empty and incomplete successful responses as ambiguous retryable errors", async () => {
  const responses = [
    new Response("not-json", { status: 200 }),
    new Response(null, { status: 200 }),
    jsonResponse({ messages: [{}] }, 200),
  ];
  for (const response of responses) {
    const result = await providerWithResponse(response).send(input);
    assert.equal(result.outcome, "retryable_error");
    assert.equal(result.errorCode, "AMBIGUOUS_PROVIDER_RESPONSE");
  }
});

test("classifies 400, 401 and 403 as permanent without exposing secrets", async () => {
  for (const status of [400, 401, 403]) {
    const response = jsonResponse({
      requestError: {
        serviceException: {
          messageId: `bad-${config.apiKey}-${input.recipient}`,
          text: `Authorization App ${config.apiKey}; recipient ${input.recipient}`,
        },
      },
    }, status);
    const result = await providerWithResponse(response).send(input);
    assert.equal(result.outcome, "permanent_error");
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes(config.apiKey), false);
    assert.equal(serialized.includes(input.recipient), false);
    assert.equal(serialized.includes("Authorization"), false);
    assert.equal("requestError" in result, false);
  }
});

test("maps explicit provider rejection to permanent error", async () => {
  for (const status of [
    { groupName: "REJECTED", name: "REJECTED_DESTINATION" },
    { groupName: "REJECTED", name: "REJECTED_SENDER" },
  ]) {
    const result = await providerWithResponse(jsonResponse({ messages: [{ messageId: "msg-rejected", status }] })).send(input);
    assert.equal(result.outcome, "permanent_error");
    assert.equal(result.httpStatus, 200);
  }
});
