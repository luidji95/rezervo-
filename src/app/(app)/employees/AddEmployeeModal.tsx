"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { X } from "lucide-react";

import { createEmployee } from "@/services/employeeService";
import { assignServiceToEmployee } from "@/services/employeeServiceRelationService";

import type { Service } from "@/types/service";

import {
  employeeSchema,
  type EmployeeFormData,
  type EmployeeFormInput,
} from "./employeeSchema";

type AddEmployeeModalProps = {
  salonId: string;
  services: Service[];
  selectedServiceIds: string[];
  setSelectedServiceIds: (ids: string[]) => void;
  onClose: () => void;
  onCreated: () => Promise<void>;
};

export function AddEmployeeModal({
  salonId,
  services,
  selectedServiceIds,
  setSelectedServiceIds,
  onClose,
  onCreated,
}: AddEmployeeModalProps) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<EmployeeFormInput, unknown, EmployeeFormData>({
    resolver: zodResolver(employeeSchema),
    defaultValues: {
      fullName: "",
      displayName: "",
      position: "",
      phone: "",
      email: "",
      bio: "",
    },
  });

  function toggleService(serviceId: string) {
    if (selectedServiceIds.includes(serviceId)) {
      setSelectedServiceIds(selectedServiceIds.filter((id) => id !== serviceId));
      return;
    }

    setSelectedServiceIds([...selectedServiceIds, serviceId]);
  }

  async function onSubmit(data: EmployeeFormData) {
    const employee = await createEmployee({
      salonId,
      fullName: data.fullName,
      displayName: data.displayName || null,
      position: data.position || null,
      phone: data.phone || null,
      email: data.email || null,
      bio: data.bio || null,
    });

    await Promise.all(
      selectedServiceIds.map((serviceId) =>
        assignServiceToEmployee({
          salonId,
          employeeId: employee.id,
          serviceId,
        })
      )
    );

    await onCreated();
  }

  return (
    <div className="employee-modal-backdrop">
      <div className="employee-modal">
        <div className="employee-modal-header">
          <div>
            <h3>Novi zaposleni</h3>
            <p>Dodajte zaposlenog i usluge koje može da obavlja.</p>
          </div>

          <button type="button" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="employee-modal-form">
          <div className="employee-form-grid">
            <FormField
              label="Ime i prezime *"
              error={errors.fullName?.message}
              full
            >
              <input {...register("fullName")} />
            </FormField>

            <FormField label="Prikazano ime">
              <input {...register("displayName")} />
            </FormField>

            <FormField label="Pozicija">
              <input {...register("position")} placeholder="Barber, Frizer..." />
            </FormField>

            <FormField label="Telefon">
              <input {...register("phone")} />
            </FormField>

            <FormField label="Email" error={errors.email?.message}>
              <input {...register("email")} />
            </FormField>

            <FormField label="Bio" full>
              <textarea rows={3} {...register("bio")} />
            </FormField>
          </div>

          <div className="employee-services-picker">
            <h4>Usluge</h4>

            {services.length === 0 ? (
              <p>Nema dodatih usluga.</p>
            ) : (
              <div className="employee-service-checkboxes">
                {services.map((service) => (
                  <label key={service.id}>
                    <input
                      type="checkbox"
                      checked={selectedServiceIds.includes(service.id)}
                      onChange={() => toggleService(service.id)}
                    />
                    <span>{service.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="employee-modal-actions">
            <button
              type="button"
              className="employees-secondary-btn"
              onClick={onClose}
            >
              Otkaži
            </button>

            <button
              type="submit"
              className="employees-primary-btn"
              disabled={isSubmitting}
            >
              {isSubmitting ? "Čuvanje..." : "Sačuvaj zaposlenog"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function FormField({
  label,
  error,
  full,
  children,
}: {
  label: string;
  error?: string;
  full?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`employee-form-field ${full ? "full" : ""}`}>
      <label>{label}</label>
      {children}
      {error && <small>{error}</small>}
    </div>
  );
}
