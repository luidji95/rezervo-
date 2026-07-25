const TEST_MESSAGE = "Rezervo test: SMS reminder sistem je uspesno povezan.";
const TIMEOUT_MS = 15_000;

function fail(message) {
  console.error(`Infobip test nije uspeo: ${message}`);
  process.exitCode = 1;
}

function maskPhone(value) {
  const phone = value.trim();
  if (phone.length <= 4) return "****";

  const visibleStart = Math.min(phone.startsWith("+") ? 5 : 4, phone.length - 3);
  return `${phone.slice(0, visibleStart)}*****${phone.slice(-3)}`;
}

function readProviderError(payload, status) {
  const exception = payload?.requestError?.serviceException;
  const text = exception?.text;
  const id = exception?.messageId;

  if (typeof text === "string" && text.trim()) {
    return `${id ? `${id}: ` : ""}${text.trim()}`;
  }

  const knownStatusHints = {
    401: "Proverite da li je API key ispravan i unet bez prefiksa 'App'.",
    403: "Proverite trial recipient, sender i dozvole Infobip naloga.",
    404: "Proverite INFOBIP_BASE_URL.",
    429: "Infobip rate limit je dostignut; pokušajte ponovo kasnije.",
  };

  return knownStatusHints[status] ?? "Infobip je odbio zahtev; proverite trial nalog i konfiguraciju.";
}

async function main() {
  const requiredVariables = {
    INFOBIP_BASE_URL: process.env.INFOBIP_BASE_URL,
    INFOBIP_API_KEY: process.env.INFOBIP_API_KEY,
    INFOBIP_SMS_SENDER: process.env.INFOBIP_SMS_SENDER,
    INFOBIP_TEST_RECIPIENT: process.env.INFOBIP_TEST_RECIPIENT,
  };

  const missing = Object.entries(requiredVariables)
    .filter(([, value]) => !value?.trim())
    .map(([name]) => name);

  if (missing.length > 0) {
    fail(`Nedostaju environment promenljive: ${missing.join(", ")}.`);
    return;
  }

  if (process.env.INFOBIP_ALLOW_TEST_SEND !== "true") {
    fail("Slanje nije dozvoljeno. Postavi INFOBIP_ALLOW_TEST_SEND=true samo za kontrolisani test.");
    return;
  }

  const baseUrl = requiredVariables.INFOBIP_BASE_URL.trim().replace(/\/+$/, "");
  const apiKey = requiredVariables.INFOBIP_API_KEY.trim();
  const sender = requiredVariables.INFOBIP_SMS_SENDER.trim();
  const recipient = requiredVariables.INFOBIP_TEST_RECIPIENT.trim();

  let endpoint;
  try {
    const parsedBaseUrl = new URL(baseUrl);
    if (parsedBaseUrl.protocol !== "https:") throw new Error("HTTPS_REQUIRED");
    endpoint = new URL("/sms/3/messages", `${baseUrl}/`).toString();
  } catch {
    fail("INFOBIP_BASE_URL mora biti validan HTTPS URL, na primer https://xxxxx.api.infobip.com.");
    return;
  }

  console.log("Validation passed");
  console.log("Infobip Base URL: configured");
  console.log("Sender: configured");
  console.log(`Recipient: ${maskPhone(recipient)}`);
  console.log("Message: prepared");
  console.log("Sending one Infobip trial SMS...");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `App ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        messages: [{
          destinations: [{ to: recipient }],
          sender,
          content: { text: TEST_MESSAGE },
        }],
      }),
      signal: controller.signal,
    });

    console.log(`HTTP status: ${response.status}`);

    let payload = null;
    const responseText = await response.text();
    if (responseText) {
      try {
        payload = JSON.parse(responseText);
      } catch {
        fail("Infobip odgovor nije validan JSON.");
        return;
      }
    }

    if (!response.ok) {
      fail(readProviderError(payload, response.status));
      return;
    }

    const result = payload?.messages?.[0];
    if (result?.messageId) console.log(`Message ID: ${result.messageId}`);

    const statusGroup = result?.status?.groupName;
    const statusName = result?.status?.name;
    if (statusGroup || statusName) {
      console.log(`Provider status: ${[statusGroup, statusName].filter(Boolean).join(" / ")}`);
    }

    console.log("Infobip connectivity test je uspešno završen.");
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      fail(`HTTP zahtev je prekinut nakon ${TIMEOUT_MS / 1000} sekundi.`);
      return;
    }

    fail("Mrežna greška. Proverite Base URL, internet vezu i Infobip dostupnost.");
  } finally {
    clearTimeout(timeout);
  }
}

await main();
