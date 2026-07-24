"use client";

import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { X } from "lucide-react";
import { InlineFormAlert } from "@/features/billing/components/InlineFormAlert";

import { createEmployee } from "@/services/employeeService";
import { assignServiceToEmployee } from "@/services/employeeServiceRelationService";

import type { Service } from "@/types/service";

import {
  employeeSchema,
  type EmployeeFormData,
  type EmployeeFormInput,
} from "./employeeSchema";
import { useEmployeeDialog } from "./useEmployeeDialog";

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
  const [formError, setFormError] = useState("");
  const [limitError, setLimitError] = useState(false);
  const alertRef = useRef<HTMLDivElement>(null);
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
  const dialogRef = useEmployeeDialog(onClose, isSubmitting);

  useEffect(() => {
    if (limitError) alertRef.current?.focus();
  }, [limitError]);

  function toggleService(serviceId: string) {
    if (selectedServiceIds.includes(serviceId)) {
      setSelectedServiceIds(selectedServiceIds.filter((id) => id !== serviceId));
      return;
    }

    setSelectedServiceIds([...selectedServiceIds, serviceId]);
  }

  async function onSubmit(data: EmployeeFormData) {
    try {
      setFormError("");
      setLimitError(false);
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
          assignServiceToEmployee({ salonId, employeeId: employee.id, serviceId })
        )
      );
      await onCreated();
    } catch (error) {
      console.error("Failed to create employee:", error);
      const reachedLimit = error instanceof Error && error.name === "EMPLOYEE_LIMIT_REACHED";
      setLimitError(reachedLimit);
      setFormError(reachedLimit ? "" : "Zaposlenog trenutno nije moguće sačuvati. Pokušajte ponovo.");
    }
  }

  return (
    <div className="employee-modal-backdrop">
      <div ref={dialogRef} className="employee-modal" role="dialog" aria-modal="true" aria-labelledby="employee-add-title">
        <div className="employee-modal-header">
          <div>
            <h3 id="employee-add-title">Novi zaposleni</h3>
            <p>Dodajte zaposlenog i usluge koje može da obavlja.</p>
          </div>

          <button type="button" onClick={onClose} aria-label="Zatvori" disabled={isSubmitting}>
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="employee-modal-form">
          <div className="employee-form-grid">
            <FormField
              label="Ime i prezime *"
              htmlFor="employee-add-full-name"
              error={errors.fullName?.message}
              full
            >
              <input id="employee-add-full-name" {...register("fullName")} />
            </FormField>

            <FormField label="Prikazano ime" htmlFor="employee-add-display-name">
              <input id="employee-add-display-name" {...register("displayName")} />
            </FormField>

            <FormField label="Pozicija" htmlFor="employee-add-position">
              <input id="employee-add-position" {...register("position")} placeholder="Barber, Frizer..." />
            </FormField>

            <FormField label="Telefon" htmlFor="employee-add-phone">
              <input id="employee-add-phone" {...register("phone")} />
            </FormField>

            <FormField label="Email" htmlFor="employee-add-email" error={errors.email?.message}>
              <input id="employee-add-email" {...register("email")} />
            </FormField>

            <FormField label="Bio" htmlFor="employee-add-bio" full>
              <textarea id="employee-add-bio" rows={3} {...register("bio")} />
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

          {limitError && <InlineFormAlert ref={alertRef} title="Dostigli ste limit zaposlenih" message="Dostigli ste maksimalan broj aktivnih zaposlenih za trenutni paket." showUpgradeAction />}
          {formError && <p className="employees-error employee-form-error" role="alert">{formError}</p>}

          <div className="employee-modal-actions">
            <button
              type="button"
              className="employees-secondary-btn"
              onClick={onClose}
              disabled={isSubmitting}
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
  htmlFor,
  error,
  full,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  full?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`employee-form-field ${full ? "full" : ""}`}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {error && <small>{error}</small>}
    </div>
  );
}
