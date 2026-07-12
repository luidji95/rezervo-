import { useState, type FormEvent } from "react";

import {
  createEmployee,
  deleteEmployee,
  getSalonEmployees,
  updateEmployee,
} from "@/services/employeeService";
import { updateOnboardingProgress } from "@/services/salonService";

import type {
  OnboardingEmployeeItem,
  TeamMode,
} from "../types/onboarding";
import {
  buildEmployeeItems,
  createEmployeeRow,
  getInitialTeamMode,
} from "../utils/onboardingMappers";
import { isOwnerEmployee } from "../utils/onboardingValidators";

type UseTeamStepParams = {
  existingSalonId: string | null;
  salonName: string;
  setCurrentStep: (step: number) => void;
  setSubmitError: (error: string | null) => void;
};

export function useTeamStep({
  existingSalonId,
  salonName,
  setCurrentStep,
  setSubmitError,
}: UseTeamStepParams) {
  const [employeesCount, setEmployeesCount] = useState(0);
  const [teamMode, setTeamMode] = useState<TeamMode>("solo");
  const [employeeItems, setEmployeeItems] = useState<OnboardingEmployeeItem[]>(
    () => buildEmployeeItems([])
  );
  const [teamValidationError, setTeamValidationError] = useState<string | null>(
    null
  );
  const [isSavingTeam, setIsSavingTeam] = useState(false);

  function updateEmployeeItem(
    index: number,
    values: Partial<OnboardingEmployeeItem>
  ) {
    setEmployeeItems((employees) =>
      employees.map((employee, employeeIndex) =>
        employeeIndex === index ? { ...employee, ...values } : employee
      )
    );
  }

  function addEmployeeItem() {
    setEmployeeItems((employees) => [
      ...employees,
      createEmployeeRow({
        fullName: "",
        position: "",
        phone: "",
        email: "",
      }),
    ]);
  }

  function removeEmployeeItem(index: number) {
    setEmployeeItems((employees) =>
      employees.filter((_, employeeIndex) => employeeIndex !== index)
    );
  }

  function validateTeam() {
    if (teamMode === "solo") {
      return null;
    }

    if (employeeItems.length === 0) {
      return "Dodajte bar jednog zaposlenog.";
    }

    for (const employee of employeeItems) {
      if (!employee.fullName.trim()) {
        return "Ime zaposlenog je obavezno.";
      }
    }

    return null;
  }

  async function saveTeam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!existingSalonId) {
      setSubmitError("Please save basic salon information first.");
      return;
    }

    const validationError = validateTeam();

    if (validationError) {
      setTeamValidationError(validationError);
      return;
    }

    setSubmitError(null);
    setTeamValidationError(null);
    setIsSavingTeam(true);

    try {
      const existingEmployees = await getSalonEmployees(existingSalonId);

      if (teamMode === "solo") {
        const ownerEmployee =
          existingEmployees.find(isOwnerEmployee) ?? existingEmployees[0];
        const ownerName = ownerEmployee?.full_name || salonName || "Vlasnik";

        if (ownerEmployee) {
          await updateEmployee({
            employeeId: ownerEmployee.id,
            fullName: ownerName,
            displayName: ownerEmployee.display_name,
            position: "Vlasnik",
            phone: ownerEmployee.phone,
            email: ownerEmployee.email,
            bio: ownerEmployee.bio,
          });
        } else {
          await createEmployee({
            salonId: existingSalonId,
            fullName: salonName || "Vlasnik",
            displayName: null,
            position: "Vlasnik",
            phone: null,
            email: null,
            bio: null,
          });
        }

        for (const employee of existingEmployees) {
          if (employee.id !== ownerEmployee?.id) {
            await deleteEmployee(employee.id);
          }
        }
      } else {
        const submittedIds = new Set(
          employeeItems
            .map((employee) => employee.id)
            .filter((employeeId): employeeId is string => Boolean(employeeId))
        );

        for (const employee of existingEmployees) {
          if (!submittedIds.has(employee.id)) {
            await deleteEmployee(employee.id);
          }
        }

        for (const employee of employeeItems) {
          const payload = {
            fullName: employee.fullName.trim(),
            displayName: null,
            position: employee.position.trim() || null,
            phone: employee.phone.trim() || null,
            email: employee.email.trim() || null,
            bio: null,
          };

          if (employee.id) {
            await updateEmployee({
              employeeId: employee.id,
              ...payload,
            });
          } else {
            await createEmployee({
              salonId: existingSalonId,
              ...payload,
            });
          }
        }
      }

      const savedEmployees = await getSalonEmployees(existingSalonId);
      setTeamMode(getInitialTeamMode(savedEmployees));
      setEmployeeItems(buildEmployeeItems(savedEmployees));
      setEmployeesCount(savedEmployees.length);
      await updateOnboardingProgress(existingSalonId, 5);
      setCurrentStep(5);
    } catch (error) {
      console.error("Failed to save team:", error);
      setSubmitError("Something went wrong while saving team.");
    } finally {
      setIsSavingTeam(false);
    }
  }

  return {
    addEmployeeItem,
    employeeItems,
    employeesCount,
    isSavingTeam,
    removeEmployeeItem,
    saveTeam,
    setEmployeeItems,
    setEmployeesCount,
    setTeamMode,
    setTeamValidationError,
    teamMode,
    teamValidationError,
    updateEmployeeItem,
    validateTeam,
  };
}

