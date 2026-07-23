"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { emailSchema } from "@/lib/validation/commonSchemas";
import type { Employee } from "@/types/employee";

const inviteFormSchema = z.object({ email: emailSchema });
type InviteFormValues = z.infer<typeof inviteFormSchema>;

export default function TeamInviteModal({
  employee,
  onClose,
  onSubmit,
}: {
  employee: Employee;
  onClose: () => void;
  onSubmit: (email: string) => Promise<void>;
}) {
  const modalRef = useRef<HTMLDivElement>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<InviteFormValues>({
    resolver: zodResolver(inviteFormSchema),
    defaultValues: { email: employee.email ?? "" },
  });

  useEffect(() => {
    const modal = modalRef.current;
    const firstInput = modal?.querySelector<HTMLElement>("input");
    firstInput?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isSubmitting) onClose();
      if (event.key !== "Tab" || !modal) return;

      const focusable = Array.from(
        modal.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isSubmitting, onClose]);

  async function submit(values: InviteFormValues) {
    try {
      await onSubmit(values.email);
    } catch (error) {
      setError("root", {
        message:
          error instanceof Error
            ? error.message
            : "Poziv trenutno nije moguće poslati.",
      });
    }
  }

  return (
    <div
      className="team-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isSubmitting) onClose();
      }}
    >
      <div
        ref={modalRef}
        className="team-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="team-invite-title"
      >
        <div className="team-modal-header">
          <div>
            <h3 id="team-invite-title">Pozovi u aplikaciju</h3>
            <p>
              {employee.display_name || employee.full_name}
              {employee.position ? ` · ${employee.position}` : ""}
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={isSubmitting} aria-label="Zatvori">
            <X size={18} />
          </button>
        </div>

        <form className="team-modal-form" onSubmit={handleSubmit(submit)}>
          <label htmlFor="team-invite-email">
            <span>Email zaposlenog</span>
            <input
              id="team-invite-email"
              type="email"
              autoComplete="email"
              disabled={isSubmitting}
              aria-invalid={Boolean(errors.email)}
              {...register("email")}
            />
          </label>
          {errors.email && <p className="settings-error-text">{errors.email.message}</p>}

          <p className="team-modal-note">
            Zaposleni će dobiti email poziv i sam postaviti lozinku.
          </p>
          {errors.root && (
            <p className="settings-error-text" role="alert">{errors.root.message}</p>
          )}

          <div className="team-modal-actions">
            <button
              type="button"
              className="settings-secondary-btn"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Otkaži
            </button>
            <button type="submit" className="settings-primary-btn" disabled={isSubmitting}>
              {isSubmitting ? "Šaljem poziv..." : "Pošalji poziv"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
