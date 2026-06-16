"use client";

import { useState } from "react";
import { X } from "lucide-react";

import { createClient, updateClient } from "@/services/clientService";
import type { Client } from "@/types/client";

type AddClientModalProps = {
  salonId: string;
  editingClient: Client | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
};

type ClientFormErrors = {
  fullName?: string;
  email?: string;
};

export function AddClientModal({
  salonId,
  editingClient,
  onClose,
  onSaved,
}: AddClientModalProps) {
  const [errors, setErrors] = useState<ClientFormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const fullName = String(formData.get("fullName") ?? "").trim();
    const phone = String(formData.get("phone") ?? "").trim();
    const email = String(formData.get("email") ?? "").trim();
    const source = String(formData.get("source") ?? "manual").trim();

    const nextErrors: ClientFormErrors = {};

    if (fullName.length < 2) {
      nextErrors.fullName = "Ime i prezime je obavezno";
    }

    if (email && !email.includes("@")) {
      nextErrors.email = "Email nije validan";
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    setErrors({});
    setIsSubmitting(true);

    try {
      if (editingClient) {
        await updateClient({
          clientId: editingClient.id,
          fullName,
          phone: phone || null,
          email: email || null,
          source,
        });
      } else {
        await createClient({
          salonId,
          fullName,
          phone: phone || null,
          email: email || null,
          source,
        });
      }

      await onSaved();
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="client-modal-backdrop">
      <div className="client-modal">
        <div className="client-modal-header">
          <div>
            <h3>{editingClient ? "Izmeni klijenta" : "Novi klijent"}</h3>
            <p>Osnovni kontakt podaci klijenta.</p>
          </div>

          <button type="button" onClick={onClose} aria-label="Zatvori">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          <div className="client-form-grid">
            <FormField label="Ime i prezime *" error={errors.fullName} full>
              <input
                name="fullName"
                type="text"
                defaultValue={editingClient?.full_name ?? ""}
                placeholder="Milos Jovanovic"
              />
            </FormField>

            <FormField label="Telefon">
              <input
                name="phone"
                type="tel"
                defaultValue={editingClient?.phone ?? ""}
                placeholder="0612345678"
              />
            </FormField>

            <FormField label="Email" error={errors.email}>
              <input
                name="email"
                type="email"
                defaultValue={editingClient?.email ?? ""}
                placeholder="milos@email.com"
              />
            </FormField>

            <FormField label="Izvor" full>
              <select name="source" defaultValue={editingClient?.source ?? "manual"}>
                <option value="manual">Manual</option>
                <option value="instagram">Instagram</option>
                <option value="public">Web</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="referral">Preporuka</option>
              </select>
            </FormField>
          </div>

          <div className="client-modal-actions">
            <button
              type="button"
              className="clients-secondary-btn"
              onClick={onClose}
            >
              Otkazi
            </button>

            <button
              type="submit"
              className="clients-primary-btn"
              disabled={isSubmitting}
            >
              {isSubmitting ? "Cuvanje..." : "Sacuvaj"}
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
    <div className={`client-form-field ${full ? "full" : ""}`}>
      <label>{label}</label>
      {children}
      {error && <small>{error}</small>}
    </div>
  );
}
