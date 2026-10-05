type ReadStage = "salon_read" | "membership_read" | "subscription_read" | "override_read";

export function logEntitlementReadFailures(
  operations: readonly { stage: ReadStage; error: unknown }[],
  log: (event: string, fields: { stage: ReadStage; dbCode: string }) => void = console.error,
) {
  for (const { stage, error } of operations) {
    if (!error) continue;
    const code = typeof error === "object" && "code" in error ? error.code : null;
    const dbCode = typeof code === "string" && code.trim() === code && /^(?:[0-9A-Z]{5}|PGRST[0-9]{3})$/.test(code)
      ? code : "UNKNOWN";
    log("ENTITLEMENTS_NOT_CONFIGURED", { stage, dbCode });
  }
}

export function billingEnvironmentFailure(value: string | undefined) {
  return { stage: "billing_environment_invalid" as const, reason: value === undefined || value === "" ? "missing" : "invalid" };
}
