import { OnboardingStepper } from "./OnboardingStepper";

type OnboardingHeaderProps = {
  currentStep: number;
  progress: number;
  steps: readonly string[];
};

export function OnboardingHeader({
  currentStep,
  progress,
  steps,
}: OnboardingHeaderProps) {
  return (
    <header className="onboarding-header">
      <p className="onboarding-eyebrow">Rezervo setup</p>
      <p className="onboarding-step-counter">
        Step {currentStep} of {steps.length}
      </p>

      <div aria-label="Onboarding progress" className="onboarding-progress">
        <div
          className="onboarding-progress-fill"
          style={{
            width: `${progress}%`,
          }}
        />
      </div>

      <OnboardingStepper currentStep={currentStep} steps={steps} />
    </header>
  );
}

