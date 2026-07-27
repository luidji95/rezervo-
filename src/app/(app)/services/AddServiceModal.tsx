"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

import {
  createService,
  updateService,
} from "@/services/serviceService";
import type { Service } from "@/types/service";
import { servicesSchema, type ServicesFormData } from "./serviceSchema";
import { DEFAULT_SERVICE_CATEGORIES, getServiceCategory } from "./serviceUtils";
import { getBusinessDataMutationMessage } from "@/features/business-data/services/businessDataMutationError";

type AddServiceModalProps = {
  salonId: string;
  categories: string[];
  editingService: Service | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
};

type ServiceFormErrors = Partial<Record<keyof ServicesFormData, string>>;

export function AddServiceModal({
  salonId,
  categories,
  editingService,
  onClose,
  onSaved,
}: AddServiceModalProps) {
  const [errors, setErrors] = useState<ServiceFormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const modal = modalRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    modal?.querySelector<HTMLElement>("input, button, select, textarea")?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isSubmitting) {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = modal?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable?.length) return;
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
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [isSubmitting, onClose]);

  const categoryOptions = Array.from(
    new Set([...DEFAULT_SERVICE_CATEGORIES, ...categories])
  );

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const parsed = servicesSchema.safeParse({
      name: formData.get("name"),
      description: formData.get("description"),
      categoryName: formData.get("categoryName"),
      durationMinutes: formData.get("durationMinutes"),
      priceAmount: formData.get("priceAmount"),
      isActive: formData.get("isActive") === "on",
      isPublic: formData.get("isPublic") === "on",
    });

    if (!parsed.success) {
      const fieldErrors = parsed.error.flatten().fieldErrors;

      setErrors({
        name: fieldErrors.name?.[0],
        durationMinutes: fieldErrors.durationMinutes?.[0],
        priceAmount: fieldErrors.priceAmount?.[0],
      });

      return;
    }

    setErrors({});
    setSubmitError(null);
    setIsSubmitting(true);

    try {
      await saveService(parsed.data);
      await onSaved();
    } catch (error) {
      console.error("Service save failed", error);
      setSubmitError(getBusinessDataMutationMessage(error, "Uslugu trenutno nije moguće sačuvati. Pokušajte ponovo."));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function saveService(data: ServicesFormData) {
    if (editingService) {
      await updateService({
        serviceId: editingService.id,
        name: data.name,
        description: data.description || null,
        categoryName: data.categoryName || null,
        durationMinutes: data.durationMinutes,
        priceAmount: data.priceAmount,
        isActive: data.isActive ?? true,
        isPublic: data.isPublic ?? true,
      });

      return;
    }

    await createService({
      salonId,
      name: data.name,
      description: data.description || null,
      categoryName: data.categoryName || null,
      durationMinutes: data.durationMinutes,
      priceAmount: data.priceAmount,
      isActive: data.isActive ?? true,
      isPublic: data.isPublic ?? true,
    });
  }

  return (
    <div className="service-modal-backdrop">
      <div
        ref={modalRef}
        className="service-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="service-modal-title"
      >
        <div className="service-modal-header">
          <div>
            <h3 id="service-modal-title">{editingService ? "Izmeni uslugu" : "Nova usluga"}</h3>
            <p>Uredite osnovne podatke, cenu, trajanje i status usluge.</p>
          </div>

          <button type="button" onClick={onClose} aria-label="Zatvori" disabled={isSubmitting}>
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="service-modal-form" noValidate>
          <div className="service-form-grid">
            <FormField label="Naziv *" htmlFor="service-name" error={errors.name} full>
              <input
                id="service-name"
                name="name"
                type="text"
                autoComplete="off"
                defaultValue={editingService?.name ?? ""}
                placeholder="Muško šišanje"
              />
            </FormField>

            <FormField label="Opis" htmlFor="service-description" full>
              <textarea
                id="service-description"
                name="description"
                rows={3}
                defaultValue={editingService?.description ?? ""}
              />
            </FormField>

            <FormField label="Trajanje" htmlFor="service-duration" error={errors.durationMinutes}>
              <input
                id="service-duration"
                name="durationMinutes"
                type="number"
                min={5}
                max={1440}
                step={1}
                defaultValue={editingService?.duration_minutes ?? 30}
              />
            </FormField>

            <FormField label="Cena" htmlFor="service-price" error={errors.priceAmount}>
              <input
                id="service-price"
                name="priceAmount"
                type="number"
                min={0}
                max={1000000}
                step="0.01"
                defaultValue={Number(editingService?.price ?? 0)}
              />
            </FormField>

            <FormField label="Kategorija" htmlFor="service-category" full>
              <select
                id="service-category"
                name="categoryName"
                defaultValue={
                  editingService ? getServiceCategory(editingService) : ""
                }
              >
                <option value="">Bez kategorije</option>
                {categoryOptions.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </FormField>
          </div>

          {submitError && (
            <p className="service-form-error" role="alert">{submitError}</p>
          )}

          <div className="service-checkbox-grid">
            <label>
              <input
                id="service-active"
                name="isActive"
                type="checkbox"
                defaultChecked={editingService?.is_active ?? true}
              />
              <span>Aktivna</span>
            </label>

            <label>
              <input
                id="service-public"
                name="isPublic"
                type="checkbox"
                defaultChecked={editingService?.is_public ?? true}
              />
              <span>Javna</span>
            </label>
          </div>

          <div className="service-modal-actions">
            <button
              type="button"
              className="services-secondary-btn"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Otkaži
            </button>

            <button
              type="submit"
              className="services-primary-btn"
              disabled={isSubmitting}
            >
              {isSubmitting ? "Čuvanje..." : "Sačuvaj"}
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
    <div className={`service-form-field ${full ? "full" : ""}`}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {error && <small>{error}</small>}
    </div>
  );
}
