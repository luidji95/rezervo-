import type { ReactNode } from "react";

import { OnboardingHeader } from "./OnboardingHeader";

type OnboardingLayoutProps = {
  children: ReactNode;
  currentStep: number;
  progress: number;
  steps: readonly string[];
  submitError: string | null;
  userEmail: string;
  onBack: () => void;
};

export function OnboardingLayout({
  children,
  currentStep,
  progress,
  steps,
  submitError,
  userEmail,
  onBack,
}: OnboardingLayoutProps) {
  return (
    <main className="onboarding-page">
      <section className="onboarding-shell">
        <h1>Set up your salon</h1>

        <p>Welcome: {userEmail}</p>

        <OnboardingHeader
          currentStep={currentStep}
          progress={progress}
          steps={steps}
        />

        {currentStep > 1 && (
          <button
            className="onboarding-secondary-btn"
            type="button"
            onClick={onBack}
          >
            Nazad
          </button>
        )}

        {submitError && <p className="onboarding-error">{submitError}</p>}

        {children}
      </section>
    </main>
  );
}

