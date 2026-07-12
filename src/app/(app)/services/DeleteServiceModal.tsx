"use client";

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
  return (
    <div className="service-modal-backdrop">
      <div className="service-modal service-confirm-modal">
        <div className="service-modal-header">
          <div>
            <h3>Obrisati uslugu?</h3>
            <p>
              Da li ste sigurni da želite da obrišete uslugu &quot;
              {service.name}&quot;?
            </p>
          </div>

          <button type="button" onClick={onCancel} aria-label="Zatvori">
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

