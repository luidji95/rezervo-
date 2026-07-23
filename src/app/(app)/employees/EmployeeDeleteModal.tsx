"use client";

import { X } from "lucide-react";
import type { Employee } from "@/types/employee";
import { useEmployeeDialog } from "./useEmployeeDialog";

type EmployeeDeleteModalProps = {
  employee: Employee;
  error: string;
  isDeleting: boolean;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
};

export function EmployeeDeleteModal({
  employee,
  error,
  isDeleting,
  onCancel,
  onConfirm,
}: EmployeeDeleteModalProps) {
  const name = employee.display_name || employee.full_name;
  const dialogRef = useEmployeeDialog(onCancel, isDeleting);

  return (
    <div className="employee-modal-backdrop" role="presentation">
      <div ref={dialogRef} className="employee-modal employee-confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="employee-delete-title">
        <div className="employee-modal-header">
          <div>
            <h3 id="employee-delete-title">Obrisati zaposlenog?</h3>
            <p>Da li ste sigurni da želite da uklonite zaposlenog „{name}“?</p>
          </div>
          <button type="button" onClick={onCancel} aria-label="Zatvori" disabled={isDeleting}><X size={18} /></button>
        </div>
        <p className="employee-confirm-text">
          Zaposleni sa istorijom termina biće deaktiviran. Ako postoje budući
          pending ili confirmed termini, uklanjanje će biti blokirano.
        </p>
        {error && <p className="employees-error" role="alert">{error}</p>}
        <div className="employee-modal-actions">
          <button type="button" className="employees-secondary-btn" onClick={onCancel} disabled={isDeleting}>Otkaži</button>
          <button type="button" className="employees-danger-btn" onClick={onConfirm} disabled={isDeleting}>
            {isDeleting ? "Uklanjam..." : "Ukloni"}
          </button>
        </div>
      </div>
    </div>
  );
}
