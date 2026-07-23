"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";

import type { Service } from "@/types/service";

type DeleteServiceModalProps = {
  isDeleting: boolean;
  service: Service;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
};

export function DeleteServiceModal({
  isDeleting,
  service,
  onCancel,
  onConfirm,
}: DeleteServiceModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const modal = modalRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    modal?.querySelector<HTMLElement>("button")?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isDeleting) onCancel();
      if (event.key !== "Tab") return;
      const buttons = modal?.querySelectorAll<HTMLElement>("button:not(:disabled)");
      if (!buttons?.length) return;
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [isDeleting, onCancel]);

  return (
    <div className="service-modal-backdrop">
      <div
        ref={modalRef}
        className="service-modal service-confirm-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="service-delete-title"
      >
        <div className="service-modal-header">
          <div>
            <h3 id="service-delete-title">Obrisati uslugu?</h3>
            <p>
              Da li ste sigurni da želite da obrišete uslugu &quot;
              {service.name}&quot;?
            </p>
          </div>

          <button type="button" onClick={onCancel} aria-label="Zatvori" disabled={isDeleting}>
            <X size={18} />
          </button>
        </div>

        <p className="service-confirm-text">
          Ako je usluga već korišćena u terminima, biće deaktivirana umesto
          trajno obrisana kako bi istorija termina ostala sačuvana.
        </p>

        <div className="service-modal-actions">
          <button
            type="button"
            className="services-secondary-btn"
            onClick={onCancel}
            disabled={isDeleting}
          >
            Otkaži
          </button>

          <button
            type="button"
            className="services-danger-btn"
            onClick={onConfirm}
            disabled={isDeleting}
          >
            {isDeleting ? "Brisanje..." : "Obriši"}
          </button>
        </div>
      </div>
    </div>
  );
}
