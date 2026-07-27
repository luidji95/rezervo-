export function remainingTrialDays(value: string, nowMs = Date.now()) {
  const endMs = new Date(value).getTime();
  if (!Number.isFinite(endMs)) return 0;
  return Math.max(0, Math.ceil((endMs - nowMs) / 86_400_000));
}
