import type { Employee } from "@/types/employee";
import type { Service } from "@/types/service";
import type { WorkingHour } from "@/types/workingHour";

import { SERVICE_TEMPLATES } from "../constants/serviceTemplates";
import { DAY_OPTIONS } from "../constants/workingDays";
import type {
  OnboardingEmployeeItem,
  OnboardingServiceItem,
  TeamMode,
  WorkingHourFormDay,
} from "../types/onboarding";
import { createEmployeeRowKey, createServiceRowKey } from "./rowKeys";
import { isOwnerEmployee } from "./onboardingValidators";

export function createServiceRow(
  service: Omit<OnboardingServiceItem, "rowKey">
): OnboardingServiceItem {
  return {
    ...service,
    rowKey: createServiceRowKey(service.id),
  };
}

export function createEmployeeRow(
  employee: Omit<OnboardingEmployeeItem, "rowKey">
): OnboardingEmployeeItem {
  return {
    ...employee,
    rowKey: createEmployeeRowKey(employee.id),
  };
}

export function buildWorkingHourDays(
  workingHours: WorkingHour[] = []
): WorkingHourFormDay[] {
  return DAY_OPTIONS.map((day) => {
    const existing = workingHours.find(
      (workingHour) => workingHour.day_of_week === day.value
    );

    return {
      dayOfWeek: day.value,
      label: day.label,
      isWorkingDay: existing?.is_working_day ?? day.isWeekday,
      opensAt: existing?.opens_at?.slice(0, 5) ?? "09:00",
      closesAt: existing?.closes_at?.slice(0, 5) ?? "17:00",
      breakStartsAt: existing?.break_starts_at?.slice(0, 5) ?? "",
      breakEndsAt: existing?.break_ends_at?.slice(0, 5) ?? "",
    };
  });
}

export function buildServiceItems(
  services: Service[],
  businessType: string
): OnboardingServiceItem[] {
  const visibleServices = services.filter(
    (service) => service.is_active && service.is_public
  );

  if (visibleServices.length > 0) {
    return visibleServices.map((service) =>
      createServiceRow({
        id: service.id,
        name: service.name,
        durationMinutes: service.duration_minutes,
        priceAmount: service.price,
      })
    );
  }

  return (SERVICE_TEMPLATES[businessType] ?? SERVICE_TEMPLATES.other).map(
    createServiceRow
  );
}

export function buildEmployeeItems(
  employees: Employee[]
): OnboardingEmployeeItem[] {
  if (employees.length === 0) {
    return [
      createEmployeeRow({
        fullName: "",
        position: "",
        phone: "",
        email: "",
      }),
    ];
  }

  return employees.map((employee) =>
    createEmployeeRow({
      id: employee.id,
      fullName: employee.full_name,
      position: employee.position ?? "",
      phone: employee.phone ?? "",
      email: employee.email ?? "",
    })
  );
}

export function getInitialTeamMode(employees: Employee[]): TeamMode {
  if (employees.length === 1 && isOwnerEmployee(employees[0])) {
    return "solo";
  }

  return employees.length > 0 ? "team" : "solo";
}

