type OnboardingStepperProps = {
  currentStep: number;
  steps: readonly string[];
};

export function OnboardingStepper({
  currentStep,
  steps,
}: OnboardingStepperProps) {
  return (
    <ol className="onboarding-stepper">
      {steps.map((step, index) => {
        const stepNumber = index + 1;

        return (
          <li
            className={`onboarding-stepper-item ${
              stepNumber === currentStep ? "active" : ""
            } ${stepNumber < currentStep ? "done" : ""}`}
            key={step}
          >
            <span>{stepNumber}</span>
            <strong>{step}</strong>
          </li>
        );
      })}
    </ol>
  );
}

