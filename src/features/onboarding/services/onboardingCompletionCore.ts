export async function completeOnboardingAndNavigate<TSaved>(input: {
  save: () => Promise<TSaved>;
  onSaved?: (saved: TSaved) => void;
  refreshAuthorization: () => Promise<{ currentSalon: { onboarding_completed: boolean } | null }>;
  navigate: () => void;
}) {
  const saved = await input.save();
  input.onSaved?.(saved);
  const refreshed = await input.refreshAuthorization();
  if (!refreshed.currentSalon?.onboarding_completed) {
    throw new Error("ONBOARDING_STATE_NOT_REFRESHED");
  }
  input.navigate();
  return saved;
}
