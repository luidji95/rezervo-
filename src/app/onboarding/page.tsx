"use client";

import { OnboardingLayout } from "@/features/onboarding/components/OnboardingLayout";
import { LoadingState } from "@/features/onboarding/components/shared/LoadingState";
import { BasicInfoStep } from "@/features/onboarding/components/steps/BasicInfoStep";
import { useOnboarding } from "@/features/onboarding/hooks/useOnboarding";

import "./onboarding.css";

export default function OnboardingPage() {
  const onboarding = useOnboarding();

  if (onboarding.loading || onboarding.checkingSalon) {
    return <LoadingState />;
  }

  if (!onboarding.user) {
    return null;
  }

  return (
    <OnboardingLayout
      submitError={onboarding.submitError}
      userEmail={onboarding.user.email ?? ""}
    >
      <BasicInfoStep
        form={onboarding.form}
        onSubmit={onboarding.onSubmitBasicInfo}
      />
    </OnboardingLayout>
  );
}
