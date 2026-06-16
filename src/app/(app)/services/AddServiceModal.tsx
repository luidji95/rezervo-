"use client";

import { useState } from "react";
import { X } from "lucide-react";

import {
  createService,
  updateService,
} from "@/services/serviceService";
import type { Service } from "@/types/service";
import { servicesSchema, type ServicesFormData } from "./serviceSchema";
import { DEFAULT_SERVICE_CATEGORIES, getServiceCategory } from "./serviceUtils";

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
    setIsSubmitting(true);

    try {
      await saveService(parsed.data);
      await onSaved();
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
      <div className="service-modal">
        <div className="service-modal-header">
          <div>
            <h3>{editingService ? "Izmeni uslugu" : "Nova usluga"}</h3>
            <p>Uredite osnovne podatke, cenu, trajanje i status usluge.</p>
          </div>

          <button type="button" onClick={onClose} aria-label="Zatvori">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="service-modal-form" noValidate>
          <div className="service-form-grid">
            <FormField label="Naziv *" error={errors.name} full>
              <input
                id="service-name"
                name="name"
                type="text"
                autoComplete="off"
                defaultValue={editingService?.name ?? ""}
                placeholder="Muško šišanje"
              />
            </FormField>

            <FormField label="Opis" full>
              <textarea
                id="service-description"
                name="description"
                rows={3}
                defaultValue={editingService?.description ?? ""}
              />
            </FormField>

            <FormField label="Trajanje" error={errors.durationMinutes}>
              <input
                id="service-duration"
                name="durationMinutes"
                type="number"
                defaultValue={editingService?.duration_minutes ?? 30}
              />
            </FormField>

            <FormField label="Cena" error={errors.priceAmount}>
              <input
                id="service-price"
                name="priceAmount"
                type="number"
                step="0.01"
                defaultValue={Number(editingService?.price ?? 0)}
              />
            </FormField>

            <FormField label="Kategorija" full>
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
    <div className={`service-form-field ${full ? "full" : ""}`}>
      <label>{label}</label>
      {children}
      {error && <small>{error}</small>}
    </div>
  );
}
