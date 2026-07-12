"use client";

import { OnboardingLayout } from "@/features/onboarding/components/OnboardingLayout";
import { LoadingState } from "@/features/onboarding/components/shared/LoadingState";
import { BasicInfoStep } from "@/features/onboarding/components/steps/BasicInfoStep";
import { FinishStep } from "@/features/onboarding/components/steps/FinishStep";
import { ServicesStep } from "@/features/onboarding/components/steps/ServicesStep";
import { TeamStep } from "@/features/onboarding/components/steps/TeamStep";
import { WorkingHoursStep } from "@/features/onboarding/components/steps/WorkingHoursStep";
import { ONBOARDING_STEPS } from "@/features/onboarding/constants/onboardingSteps";
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
      currentStep={onboarding.currentStep}
      progress={onboarding.progress}
      steps={ONBOARDING_STEPS}
      submitError={onboarding.submitError}
      userEmail={onboarding.user.email ?? ""}
      onBack={onboarding.goBack}
    >
      {onboarding.currentStep === 1 && (
        <BasicInfoStep
          form={onboarding.form}
          onSubmit={onboarding.onSubmitBasicInfo}
        />
      )}

      {onboarding.currentStep === 2 && (
        <WorkingHoursStep
          isSavingWorkingHours={
            onboarding.workingHoursStep.isSavingWorkingHours
          }
          isSkippingSetup={onboarding.isSkippingSetup}
          workingHourDays={onboarding.workingHoursStep.workingHourDays}
          onApplyTemplate={
            onboarding.workingHoursStep.applyWorkingHoursTemplate
          }
          onSave={onboarding.workingHoursStep.saveWorkingHours}
          onSkipSetup={onboarding.skipSetupAndGoToDashboard}
          onUpdateDay={onboarding.workingHoursStep.updateWorkingHourDay}
        />
      )}

      {onboarding.currentStep === 3 && (
        <ServicesStep
          isSavingServices={onboarding.servicesStep.isSavingServices}
          serviceItems={onboarding.servicesStep.serviceItems}
          serviceValidationError={
            onboarding.servicesStep.serviceValidationError
          }
          onAddService={onboarding.servicesStep.addServiceItem}
          onApplyTemplate={onboarding.servicesStep.applyServiceTemplate}
          onRemoveService={onboarding.servicesStep.removeServiceItem}
          onSave={onboarding.servicesStep.saveServices}
          onUpdateService={onboarding.servicesStep.updateServiceItem}
        />
      )}

      {onboarding.currentStep === 4 && (
        <TeamStep
          employeeItems={onboarding.teamStep.employeeItems}
          isSavingTeam={onboarding.teamStep.isSavingTeam}
          teamMode={onboarding.teamStep.teamMode}
          teamValidationError={onboarding.teamStep.teamValidationError}
          onAddEmployee={onboarding.teamStep.addEmployeeItem}
          onRemoveEmployee={onboarding.teamStep.removeEmployeeItem}
          onSave={onboarding.teamStep.saveTeam}
          onSetTeamMode={onboarding.teamStep.setTeamMode}
          onSetTeamValidationError={
            onboarding.teamStep.setTeamValidationError
          }
          onUpdateEmployee={onboarding.teamStep.updateEmployeeItem}
        />
      )}

      {onboarding.currentStep === 5 && (
        <FinishStep
          employeesCount={onboarding.teamStep.employeesCount}
          hasWorkingHours={onboarding.workingHoursStep.hasWorkingHours}
          isLoading={onboarding.isSkippingSetup}
          salonName={onboarding.salonName}
          salonSlug={onboarding.salonSlug}
          servicesCount={onboarding.servicesStep.servicesCount}
          onBack={onboarding.goBack}
          onGoToCalendar={() =>
            onboarding.finishOnboardingAndNavigate("/calendar")
          }
          onGoToDashboard={() =>
            onboarding.finishOnboardingAndNavigate("/dashboard")
          }
        />
      )}
    </OnboardingLayout>
  );
}

