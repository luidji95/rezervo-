"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { useSalon } from "@/context/SalonContext";

import {
  createEmployee,
  deleteEmployee,
  getSalonEmployees,
  updateEmployee,
} from "@/services/employeeService";

import { getSalonServices } from "@/services/serviceService";

import {
  assignServiceToEmployee,
  getSalonEmployeeServices,
  removeServiceFromEmployee,
} from "@/services/employeeServiceRelationService";

import type { Employee } from "@/types/employee";
import type { Service } from "@/types/service";
import type { EmployeeService } from "@/types/employeeService";

import {
  employeeSchema,
  type EmployeeFormData,
  type EmployeeFormInput,
} from "./employeeSchema";

const emptyFormValues: EmployeeFormInput = {
  fullName: "",
  displayName: "",
  position: "",
  phone: "",
  email: "",
  bio: "",
};

export default function EmployeesPage() {
  const { currentSalon, salonLoading } = useSalon();

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [employeeServices, setEmployeeServices] = useState<EmployeeService[]>(
    []
  );

  const [employeesLoading, setEmployeesLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [relationLoadingId, setRelationLoadingId] = useState<string | null>(
    null
  );

  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<EmployeeFormInput, unknown, EmployeeFormData>({
    resolver: zodResolver(employeeSchema),
    defaultValues: emptyFormValues,
  });

  useEffect(() => {
    const salonId = currentSalon?.id;
    if (!salonId) return;

    let ignore = false;

    async function loadEmployeesData() {
      setEmployeesLoading(true);

      try {
        const [employeesData, servicesData, employeeServicesData] =
          await Promise.all([
            getSalonEmployees(salonId),
            getSalonServices(salonId),
            getSalonEmployeeServices(salonId),
          ]);

        if (!ignore) {
          setEmployees(employeesData);
          setServices(servicesData);
          setEmployeeServices(employeeServicesData);
        }
      } catch (error) {
        console.error("Failed to fetch employees data:", error);
      } finally {
        if (!ignore) {
          setEmployeesLoading(false);
        }
      }
    }

    loadEmployeesData();

    return () => {
      ignore = true;
    };
  }, [currentSalon?.id]);

  function isServiceAssignedToEmployee(employeeId: string, serviceId: string) {
    return employeeServices.some(
      (relation) =>
        relation.employee_id === employeeId && relation.service_id === serviceId
    );
  }

  async function handleToggleEmployeeService(
    employeeId: string,
    serviceId: string
  ) {
    if (!currentSalon) return;

    const relationKey = `${employeeId}-${serviceId}`;
    const isAssigned = isServiceAssignedToEmployee(employeeId, serviceId);

    setRelationLoadingId(relationKey);

    try {
      if (isAssigned) {
        await removeServiceFromEmployee({
          employeeId,
          serviceId,
        });

        setEmployeeServices((prev) =>
          prev.filter(
            (relation) =>
              !(
                relation.employee_id === employeeId &&
                relation.service_id === serviceId
              )
          )
        );

        return;
      }

      const newRelation = await assignServiceToEmployee({
        salonId: currentSalon.id,
        employeeId,
        serviceId,
      });

      setEmployeeServices((prev) => [newRelation, ...prev]);
    } catch (error) {
      console.error("Failed to update employee service relation:", error);
    } finally {
      setRelationLoadingId(null);
    }
  }

  async function onSubmit(data: EmployeeFormData) {
    if (!currentSalon) return;

    setSubmitError(null);

    try {
      if (editingEmployee) {
        const updatedEmployee = await updateEmployee({
          employeeId: editingEmployee.id,
          fullName: data.fullName,
          displayName: data.displayName || null,
          position: data.position || null,
          phone: data.phone || null,
          email: data.email || null,
          bio: data.bio || null,
        });

        setEmployees((prev) =>
          prev.map((employee) =>
            employee.id === updatedEmployee.id ? updatedEmployee : employee
          )
        );

        setEditingEmployee(null);
        reset(emptyFormValues);
        return;
      }

      const newEmployee = await createEmployee({
        salonId: currentSalon.id,
        fullName: data.fullName,
        displayName: data.displayName || null,
        position: data.position || null,
        phone: data.phone || null,
        email: data.email || null,
        bio: data.bio || null,
      });

      setEmployees((prev) => [newEmployee, ...prev]);
      reset(emptyFormValues);
    } catch (error) {
      console.error("Failed to save employee:", error);
      setSubmitError("Something went wrong while saving employee.");
    }
  }

  async function handleDelete(employeeId: string) {
    setDeleteError(null);
    setDeletingId(employeeId);

    try {
      await deleteEmployee(employeeId);

      setEmployees((prev) =>
        prev.filter((employee) => employee.id !== employeeId)
      );

      setEmployeeServices((prev) =>
        prev.filter((relation) => relation.employee_id !== employeeId)
      );

      if (editingEmployee?.id === employeeId) {
        setEditingEmployee(null);
        reset(emptyFormValues);
      }
    } catch (error) {
      console.error("Failed to delete employee:", error);
      setDeleteError("Something went wrong while deleting employee.");
    } finally {
      setDeletingId(null);
    }
  }

  function handleStartEdit(employee: Employee) {
    setSubmitError(null);
    setDeleteError(null);
    setEditingEmployee(employee);

    reset({
      fullName: employee.full_name,
      displayName: employee.display_name ?? "",
      position: employee.position ?? "",
      phone: employee.phone ?? "",
      email: employee.email ?? "",
      bio: employee.bio ?? "",
    });
  }

  function handleCancelEdit() {
    setEditingEmployee(null);
    reset(emptyFormValues);
  }

  if (salonLoading) {
    return <p>Loading salon...</p>;
  }

  if (!currentSalon) {
    return <p>No salon found.</p>;
  }

  return (
    <main>
      <h1>Employees</h1>
      <p>Manage employees for {currentSalon.name}</p>

      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <h2>{editingEmployee ? "Edit employee" : "Create employee"}</h2>

        <div>
          <label htmlFor="fullName">Full name</label>
          <input id="fullName" type="text" {...register("fullName")} />
          {errors.fullName && <p>{errors.fullName.message}</p>}
        </div>

        <div>
          <label htmlFor="displayName">Display name</label>
          <input id="displayName" type="text" {...register("displayName")} />
        </div>

        <div>
          <label htmlFor="position">Position</label>
          <input id="position" type="text" {...register("position")} />
        </div>

        <div>
          <label htmlFor="phone">Phone</label>
          <input id="phone" type="text" {...register("phone")} />
        </div>

        <div>
          <label htmlFor="email">Email</label>
          <input id="email" type="email" {...register("email")} />
          {errors.email && <p>{errors.email.message}</p>}
        </div>

        <div>
          <label htmlFor="bio">Bio</label>
          <textarea id="bio" {...register("bio")} />
        </div>

        {submitError && <p>{submitError}</p>}

        <button type="submit" disabled={isSubmitting}>
          {isSubmitting
            ? editingEmployee
              ? "Saving..."
              : "Creating..."
            : editingEmployee
              ? "Save changes"
              : "Create employee"}
        </button>

        {editingEmployee && (
          <button type="button" onClick={handleCancelEdit}>
            Cancel edit
          </button>
        )}
      </form>

      <section>
        <h2>Existing employees</h2>

        {deleteError && <p>{deleteError}</p>}
        {employeesLoading && <p>Loading employees...</p>}

        {!employeesLoading && employees.length === 0 && (
          <p>No employees yet.</p>
        )}

        {!employeesLoading &&
          employees.map((employee) => (
            <article key={employee.id}>
              <h3>{employee.display_name || employee.full_name}</h3>

              <p>{employee.full_name}</p>

              {employee.position && <p>{employee.position}</p>}
              {employee.phone && <p>{employee.phone}</p>}
              {employee.email && <p>{employee.email}</p>}
              {employee.bio && <p>{employee.bio}</p>}

              <p>
                Active: {employee.is_active ? "Yes" : "No"} | Bookable:{" "}
                {employee.is_bookable ? "Yes" : "No"}
              </p>

              <div>
                <h4>Available services</h4>

                {services.length === 0 && <p>No services created yet.</p>}

                {services.length > 0 &&
                  services.map((service) => {
                    const relationKey = `${employee.id}-${service.id}`;
                    const checked = isServiceAssignedToEmployee(
                      employee.id,
                      service.id
                    );

                    return (
                      <label key={service.id}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={relationLoadingId === relationKey}
                          onChange={() =>
                            handleToggleEmployeeService(employee.id, service.id)
                          }
                        />
                        {service.name}
                      </label>
                    );
                  })}
              </div>

              <button type="button" onClick={() => handleStartEdit(employee)}>
                Edit
              </button>

              <button
                type="button"
                onClick={() => handleDelete(employee.id)}
                disabled={deletingId === employee.id}
              >
                {deletingId === employee.id ? "Deleting..." : "Delete"}
              </button>
            </article>
          ))}
      </section>
    </main>
  );
}