"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { X } from "lucide-react";

import { updateEmployee } from "@/services/employeeService";
import { syncEmployeeServices } from "@/services/employeeServiceRelationService";
import type { Employee } from "@/types/employee";
import type { Service } from "@/types/service";

import { EmployeeServiceSelector } from "./EmployeeServiceSelector";
import {
  employeeSchema,
  type EmployeeFormData,
  type EmployeeFormInput,
} from "./employeeSchema";
import { useEmployeeDialog } from "./useEmployeeDialog";

type EmployeeEditModalProps = {
  employee: Employee;
  salonId: string;
  services: Service[];
  initialServiceIds: string[];
  onClose: () => void;
  onSaved: () => Promise<void>;
};

export function EmployeeEditModal({
  employee,
  salonId,
  services,
  initialServiceIds,
  onClose,
  onSaved,
}: EmployeeEditModalProps) {
  const [selectedServiceIds, setSelectedServiceIds] =
    useState(initialServiceIds);
  const [formError, setFormError] = useState("");
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<EmployeeFormInput, unknown, EmployeeFormData>({
    resolver: zodResolver(employeeSchema),
    defaultValues: {
      fullName: employee.full_name,
      displayName: employee.display_name ?? "",
      position: employee.position ?? "",
      phone: employee.phone ?? "",
      email: employee.email ?? "",
      bio: employee.bio ?? "",
      isActive: employee.is_active,
      isBookable: employee.is_bookable,
      isPublic: employee.is_public,
    },
  });
  const dialogRef = useEmployeeDialog(onClose, isSubmitting);

  async function onSubmit(data: EmployeeFormData) {
    try {
      setFormError("");
      await updateEmployee({
        employeeId: employee.id,
        salonId,
        fullName: data.fullName,
        displayName: data.displayName || null,
        position: data.position || null,
        phone: data.phone || null,
        email: data.email || null,
        bio: data.bio || null,
        isActive: data.isActive,
        isBookable: data.isBookable,
        isPublic: data.isPublic,
      });
      await syncEmployeeServices({
        employeeId: employee.id,
        salonId,
        serviceIds: selectedServiceIds,
      });
      await onSaved();
    } catch (error) {
      console.error("Failed to update employee:", error);
      setFormError("Izmene trenutno nije moguće sačuvati. Pokušajte ponovo.");
    }
  }

  return (
    <div className="employee-modal-backdrop" role="presentation">
      <div ref={dialogRef} className="employee-modal" role="dialog" aria-modal="true" aria-labelledby="employee-edit-title">
        <div className="employee-modal-header">
          <div>
            <h3 id="employee-edit-title">Izmeni zaposlenog</h3>
            <p>Izmenite podatke i usluge koje zaposleni pruža.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Zatvori" disabled={isSubmitting}>
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="employee-modal-form">
          <div className="employee-form-grid">
            <label className="employee-form-field full">
              <span>Ime i prezime *</span>
              <input {...register("fullName")} />
              {errors.fullName && <small>{errors.fullName.message}</small>}
            </label>
            <label className="employee-form-field">
              <span>Prikazano ime</span>
              <input {...register("displayName")} />
            </label>
            <label className="employee-form-field">
              <span>Pozicija</span>
              <input {...register("position")} />
            </label>
            <label className="employee-form-field">
              <span>Telefon</span>
              <input {...register("phone")} />
            </label>
            <label className="employee-form-field">
              <span>Email</span>
              <input type="email" {...register("email")} />
              {errors.email && <small>{errors.email.message}</small>}
            </label>
            <label className="employee-form-field full">
              <span>Bio</span>
              <textarea rows={3} {...register("bio")} />
            </label>
          </div>

          <div className="employee-visibility-options">
            <label>
              <span><strong>Aktivan</strong><small>Zaposleni je aktivan član salona.</small></span>
              <input type="checkbox" {...register("isActive")} />
            </label>
            <label>
              <span><strong>Dostupan za zakazivanje</strong><small>Može biti izabran pri kreiranju termina.</small></span>
              <input type="checkbox" {...register("isBookable")} />
            </label>
            <label>
              <span><strong>Javno vidljiv</strong><small>Prikazuje se u javnom booking flow-u.</small></span>
              <input type="checkbox" {...register("isPublic")} />
            </label>
          </div>

          <EmployeeServiceSelector
            services={services}
            selectedServiceIds={selectedServiceIds}
            onChange={setSelectedServiceIds}
            disabled={isSubmitting}
          />

          {formError && <p className="employees-error" role="alert">{formError}</p>}

          <div className="employee-modal-actions">
            <button type="button" className="employees-secondary-btn" onClick={onClose} disabled={isSubmitting}>Otkaži</button>
            <button type="submit" className="employees-primary-btn" disabled={isSubmitting}>
              {isSubmitting ? "Čuvam..." : "Sačuvaj izmene"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
