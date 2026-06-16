"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useSalon } from "@/context/SalonContext";
import {
  deleteEmployee,
  getSalonEmployees,
} from "@/services/employeeService";
import { getSalonEmployeeServices } from "@/services/employeeServiceRelationService";
import { getSalonServices } from "@/services/serviceService";
import {
  getEmployeeWorkingHours,
  getSalonWorkingHours,
} from "@/services/workingService";

import type { Employee } from "@/types/employee";
import type { EmployeeService } from "@/types/employeeService";
import type { Service } from "@/types/service";
import type { WorkingHour } from "@/types/workingHour";

export type EmployeeStatusFilter = "all" | "active" | "inactive";

export function useEmployeesPageData() {
  const { currentSalon, salonLoading } = useSalon();

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [employeeServices, setEmployeeServices] = useState<EmployeeService[]>(
    []
  );
  const [salonWorkingHours, setSalonWorkingHours] = useState<WorkingHour[]>([]);
  const [selectedEmployeeHours, setSelectedEmployeeHours] = useState<
    WorkingHour[]
  >([]);

  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(
    null
  );
  const [searchValue, setSearchValue] = useState("");
  const [statusFilter, setStatusFilter] =
    useState<EmployeeStatusFilter>("all");
  const [loading, setLoading] = useState(true);

  const salonId = currentSalon?.id;

  const loadData = useCallback(async () => {
    if (!salonId) return;

    try {
      setLoading(true);

      const [employeesData, servicesData, relationsData, workingHoursData] =
        await Promise.all([
          getSalonEmployees(salonId),
          getSalonServices(salonId),
          getSalonEmployeeServices(salonId),
          getSalonWorkingHours(salonId),
        ]);

      setEmployees(employeesData);
      setServices(servicesData);
      setEmployeeServices(relationsData);
      setSalonWorkingHours(workingHoursData);

      setSelectedEmployee((current) => {
        if (current) {
          return (
            employeesData.find((employee) => employee.id === current.id) ??
            employeesData[0] ??
            null
          );
        }

        return employeesData[0] ?? null;
      });
    } catch (error) {
      console.error("Greška pri učitavanju zaposlenih:", error);
    } finally {
      setLoading(false);
    }
  }, [salonId]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadData();
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [loadData]);

  useEffect(() => {
    const currentSalonId = salonId;
    const employeeId = selectedEmployee?.id;

    if (!currentSalonId || !employeeId) {
      const timeoutId = window.setTimeout(() => {
        setSelectedEmployeeHours([]);
      }, 0);

      return () => {
        window.clearTimeout(timeoutId);
      };
    }

    const checkedSalonId = currentSalonId;
    const checkedEmployeeId = employeeId;

    let ignore = false;

    async function loadSelectedEmployeeHours() {
      try {
        const data = await getEmployeeWorkingHours(
          checkedSalonId,
          checkedEmployeeId
        );

        if (!ignore) {
          setSelectedEmployeeHours(data);
        }
      } catch (error) {
        console.error("Greška pri učitavanju radnog vremena zaposlenog:", error);
      }
    }

    void loadSelectedEmployeeHours();

    return () => {
      ignore = true;
    };
  }, [salonId, selectedEmployee?.id]);

  const filteredEmployees = useMemo(() => {
    return employees.filter((employee) => {
      const search = searchValue.toLowerCase();

      const matchesSearch =
        employee.full_name.toLowerCase().includes(search) ||
        employee.display_name?.toLowerCase().includes(search) ||
        employee.phone?.toLowerCase().includes(search) ||
        employee.email?.toLowerCase().includes(search);

      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "active" && employee.is_active) ||
        (statusFilter === "inactive" && !employee.is_active);

      return matchesSearch && matchesStatus;
    });
  }, [employees, searchValue, statusFilter]);

  const totalEmployees = employees.length;
  const activeEmployees = employees.filter(
    (employee) => employee.is_active
  ).length;

  const getServicesForEmployee = useCallback(
    (employeeId: string) => {
      const relationServiceIds = employeeServices
        .filter((item) => item.employee_id === employeeId)
        .map((item) => item.service_id);

      return services.filter((service) =>
        relationServiceIds.includes(service.id)
      );
    },
    [employeeServices, services]
  );

  async function handleDeleteEmployee(employeeId: string) {
    const confirmed = window.confirm(
      "Da li sigurno želiš da obrišeš zaposlenog?"
    );

    if (!confirmed) return;

    try {
      await deleteEmployee(employeeId);
      await loadData();
    } catch (error) {
      console.error("Greška pri brisanju zaposlenog:", error);
    }
  }

  return {
    activeEmployees,
    currentSalon,
    filteredEmployees,
    getServicesForEmployee,
    handleDeleteEmployee,
    loadData,
    loading,
    salonId,
    salonLoading,
    salonWorkingHours,
    searchValue,
    selectedEmployee,
    selectedEmployeeHours,
    services,
    setSearchValue,
    setSelectedEmployee,
    setStatusFilter,
    statusFilter,
    totalEmployees,
  };
}
