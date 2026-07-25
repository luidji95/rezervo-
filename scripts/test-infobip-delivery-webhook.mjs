import { randomUUID } from "node:crypto";

const TIMEOUT_MS = 15_000;
const WEBHOOK_PATH = "/api/webhooks/infobip/sms-delivery";

function fail(message) {
  console.error(`Webhook smoke test failed: ${message}`);
  process.exitCode = 1;
}

function validateUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  const isLocalhost = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(isLocalhost && url.protocol === "http:")) return null;
  if (!url.pathname.endsWith(WEBHOOK_PATH) || url.search || url.hash) return null;
  if (url.username || url.password) return null;
  return url.toString();
}

async function main() {
  const webhookUrlValue = process.env.INFOBIP_WEBHOOK_TEST_URL?.trim();
  const username = process.env.INFOBIP_WEBHOOK_USERNAME?.trim();
  const password = process.env.INFOBIP_WEBHOOK_PASSWORD;

  const missing = [
    ["INFOBIP_WEBHOOK_TEST_URL", webhookUrlValue],
    ["INFOBIP_WEBHOOK_USERNAME", username],
    ["INFOBIP_WEBHOOK_PASSWORD", password],
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length > 0) {
    fail(`Missing environment variables: ${missing.join(", ")}.`);
    return;
  }

  const webhookUrl = validateUrl(webhookUrlValue);
  if (!webhookUrl) {
    fail(`INFOBIP_WEBHOOK_TEST_URL must use HTTPS (except localhost) and end with ${WEBHOOK_PATH}.`);
    return;
  }

  const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  const payload = {
    results: [{
      messageId: `rezervo-webhook-smoke-test-${randomUUID()}`,
      status: {
        id: 5,
        groupId: 3,
        groupName: "DELIVERED",
        name: "DELIVERED_TO_HANDSET",
      },
      error: {
        id: 0,
        name: "NO_ERROR",
        groupName: "OK",
        permanent: false,
      },
      doneAt: new Date().toISOString(),
    }],
  };

  console.log("Webhook URL: configured");
  console.log("Authentication: configured");
  console.log("Sending safe unknown-message smoke test...");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        Authorization: authorization,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    console.log(`HTTP status: ${response.status}`);

    let result = null;
    try {
      result = await response.json();
    } catch {
      fail("Production webhook response is not valid JSON.");
      return;
    }

    if (!response.ok) {
      const safeReason = response.status === 401
        ? "Basic authentication or production webhook credentials are not configured correctly."
        : response.status === 400
          ? "Production webhook rejected the test payload."
          : response.status >= 500
            ? "Production webhook reported a temporary server error."
            : "Production webhook returned an unexpected HTTP status.";
      fail(safeReason);
      return;
    }

    const expected = { received: 1, updated: 0, ignored: 1, invalid: 0 };
    const matchesExpected = Object.entries(expected).every(([key, value]) => result?.[key] === value);
    if (!matchesExpected) {
      fail("Production webhook returned an unexpected summary; no raw response was logged.");
      return;
    }

    console.log(`Received: ${result.received}`);
    console.log(`Updated: ${result.updated}`);
    console.log(`Ignored: ${result.ignored}`);
    console.log(`Invalid: ${result.invalid}`);
    console.log("Webhook smoke test successful.");
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      fail(`Production webhook request timed out after ${TIMEOUT_MS / 1_000} seconds.`);
      return;
    }
    fail("Network error while contacting the production webhook.");
  } finally {
    clearTimeout(timeout);
  }
}

await main();
