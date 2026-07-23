import { createHash } from "node:crypto";

const SIMULATION_NAMESPACE = "3f99165c-f9c4-4ea4-a650-8c868e02a5ce";

function uuidBytes(value: string) {
  return Buffer.from(value.replaceAll("-", ""), "hex");
}

export function deterministicUuid(logicalKey: string) {
  const digest = createHash("sha1")
    .update(uuidBytes(SIMULATION_NAMESPACE))
    .update(logicalKey)
    .digest()
    .subarray(0, 16);

  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;

  const hex = digest.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createRunIdentity(input: {
  seed: string;
  profile: string;
  salonId: string;
  anchorDate: string;
  scenarioVersion: number;
}) {
  return [
    `v${input.scenarioVersion}`,
    input.salonId,
    input.profile,
    input.seed,
    input.anchorDate,
  ].join(":");
}
