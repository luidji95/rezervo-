"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

import { createClient, updateClient } from "@/services/clientService";
import type { Client } from "@/types/client";
import { clientSchema } from "./clientSchema";
import { getBusinessDataMutationMessage } from "@/features/business-data/services/businessDataMutationError";

type AddClientModalProps = {
  salonId: string;
  editingClient: Client | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
};

type ClientFormErrors = {
  fullName?: string;
  phone?: string;
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
  const [submitError, setSubmitError] = useState("");
  const modalRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const submittingRef = useRef(false);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    submittingRef.current = isSubmitting;
    onCloseRef.current = onClose;
  }, [isSubmitting, onClose]);

  useEffect(() => {
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submittingRef.current) onCloseRef.current();
      if (event.key !== "Tab") return;
      const focusable = modalRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])');
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      returnFocusRef.current?.focus();
    };
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const parsed = clientSchema.safeParse({
      fullName: String(formData.get("fullName") ?? ""),
      phone: String(formData.get("phone") ?? ""),
      email: String(formData.get("email") ?? ""),
      source: String(formData.get("source") ?? "manual"),
    });

    if (!parsed.success) {
      const fields = parsed.error.flatten().fieldErrors;
      setErrors({ fullName: fields.fullName?.[0], phone: fields.phone?.[0], email: fields.email?.[0] });
      return;
    }

    const { fullName, phone, email, source } = parsed.data;

    setErrors({});
    setSubmitError("");
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
    } catch (error) {
      setSubmitError(getBusinessDataMutationMessage(error, "Klijenta trenutno nije moguće sačuvati. Pokušajte ponovo."));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="client-modal-backdrop" onClick={() => { if (!isSubmitting) onClose(); }}>
      <div ref={modalRef} className="client-modal" role="dialog" aria-modal="true" aria-labelledby="client-modal-title" onClick={(event) => event.stopPropagation()}>
        <div className="client-modal-header">
          <div>
            <h3 id="client-modal-title">{editingClient ? "Izmeni klijenta" : "Novi klijent"}</h3>
            <p>Osnovni kontakt podaci klijenta.</p>
          </div>

          <button ref={closeButtonRef} type="button" onClick={onClose} aria-label="Zatvori" disabled={isSubmitting}>
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

            <FormField label="Telefon" error={errors.phone}>
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

          {submitError && <p className="clients-error" role="alert">{submitError}</p>}
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
