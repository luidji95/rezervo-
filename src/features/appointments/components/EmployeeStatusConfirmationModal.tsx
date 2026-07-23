"use client";

import { useEffect, useRef } from "react";

import type { EmployeeAppointmentStatusAction } from "../employeeAppointmentStatusTransitions";

type Props = {
  action: EmployeeAppointmentStatusAction | null;
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function EmployeeStatusConfirmationModal({
  action,
  loading,
  onCancel,
  onConfirm,
}: Props) {
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!action) return;
    cancelButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !loading) onCancel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [action, loading, onCancel]);

  if (!action) return null;

  return (
    <div
      className="employee-status-modal__backdrop"
      role="presentation"
      onMouseDown={() => !loading && onCancel()}
    >
      <div
        className="employee-status-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="employee-status-modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="employee-status-modal-title">{action.confirmationTitle}</h2>
        <p>{action.confirmationMessage}</p>
        <div className="employee-status-modal__actions">
          <button ref={cancelButtonRef} type="button" onClick={onCancel} disabled={loading}>
            Odustani
          </button>
          <button
            type="button"
            className={`employee-status-action employee-status-action--${action.tone}`}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? action.loadingLabel : action.label}
          </button>
        </div>
      </div>
    </div>
  );
}
