import type { Employee } from "@/types/employee";

import { ONBOARDING_STEPS } from "../constants/onboardingSteps";

export function normalizeStep(step?: number | null) {
  if (!step || step < 1) return 1;
  if (step > ONBOARDING_STEPS.length) return ONBOARDING_STEPS.length;

  return step;
}

export function isOwnerEmployee(employee: Employee) {
  return employee.position?.toLowerCase() === "vlasnik";
}

export function normalizeServiceName(name: string) {
  return name.trim().toLocaleLowerCase("sr");
}
