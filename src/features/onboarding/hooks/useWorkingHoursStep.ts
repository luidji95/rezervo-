import { useState, type FormEvent } from "react";

import { updateOnboardingProgress } from "@/services/salonService";
import { syncWorkingHours } from "@/services/workingService";

import type { WorkingHourFormDay } from "../types/onboarding";
import { buildWorkingHourDays } from "../utils/onboardingMappers";

type UseWorkingHoursStepParams = {
  existingSalonId: string | null;
  setCurrentStep: (step: number) => void;
  setSubmitError: (error: string | null) => void;
};

export function useWorkingHoursStep({
  existingSalonId,
  setCurrentStep,
  setSubmitError,
}: UseWorkingHoursStepParams) {
  const [hasWorkingHours, setHasWorkingHours] = useState(false);
  const [workingHourDays, setWorkingHourDays] = useState<WorkingHourFormDay[]>(
    () => buildWorkingHourDays()
  );
  const [isSavingWorkingHours, setIsSavingWorkingHours] = useState(false);

  function updateWorkingHourDay(
    index: number,
    values: Partial<WorkingHourFormDay>
  ) {
    setWorkingHourDays((days) =>
      days.map((day, dayIndex) =>
        dayIndex === index ? { ...day, ...values } : day
      )
    );
  }

  function applyWorkingHoursTemplate(opensAt: string, closesAt: string) {
    setWorkingHourDays((days) =>
      days.map((day) => ({
        ...day,
        isWorkingDay: day.dayOfWeek >= 1 && day.dayOfWeek <= 5,
        opensAt,
        closesAt,
      }))
    );
  }

  async function saveWorkingHours(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!existingSalonId) {
      setSubmitError("Please save basic salon information first.");
      return;
    }

    setSubmitError(null);
    setIsSavingWorkingHours(true);

    try {
      await syncWorkingHours(
        existingSalonId,
        null,
        workingHourDays.map((day) => ({
            salon_id: existingSalonId,
            employee_id: null,
            day_of_week: day.dayOfWeek,
            opens_at: day.opensAt,
            closes_at: day.closesAt,
            break_starts_at: day.breakStartsAt || null,
            break_ends_at: day.breakEndsAt || null,
            is_working_day: day.isWorkingDay,
          }))
      );

      await updateOnboardingProgress(existingSalonId, 3);
      setHasWorkingHours(true);
      setCurrentStep(3);
    } catch (error) {
      console.error("Failed to save working hours:", error);
      setSubmitError("Something went wrong while saving working hours.");
    } finally {
      setIsSavingWorkingHours(false);
    }
  }

  return {
    applyWorkingHoursTemplate,
    hasWorkingHours,
    isSavingWorkingHours,
    saveWorkingHours,
    setHasWorkingHours,
    setWorkingHourDays,
    updateWorkingHourDay,
    workingHourDays,
  };
}
