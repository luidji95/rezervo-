import { useState, type FormEvent } from "react";

import { updateOnboardingProgress } from "@/services/salonService";
import {
  createService,
  getSalonServices,
  updateService,
} from "@/services/serviceService";

import { SERVICE_TEMPLATES } from "../constants/serviceTemplates";
import type { OnboardingServiceItem } from "../types/onboarding";
import {
  buildServiceItems,
  createServiceRow,
} from "../utils/onboardingMappers";

type UseServicesStepParams = {
  existingSalonId: string | null;
  salonBusinessType: string;
  setCurrentStep: (step: number) => void;
  setSubmitError: (error: string | null) => void;
};

export function useServicesStep({
  existingSalonId,
  salonBusinessType,
  setCurrentStep,
  setSubmitError,
}: UseServicesStepParams) {
  const [servicesCount, setServicesCount] = useState(0);
  const [serviceItems, setServiceItems] = useState<OnboardingServiceItem[]>(
    () => buildServiceItems([], "barbershop")
  );
  const [serviceValidationError, setServiceValidationError] = useState<
    string | null
  >(null);
  const [isSavingServices, setIsSavingServices] = useState(false);

  function updateServiceItem(
    index: number,
    values: Partial<OnboardingServiceItem>
  ) {
    setServiceItems((items) =>
      items.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...values } : item
      )
    );
  }

  function addServiceItem() {
    setServiceItems((items) => [
      ...items,
      createServiceRow({
        name: "",
        durationMinutes: 30,
        priceAmount: 0,
      }),
    ]);
  }

  function removeServiceItem(index: number) {
    setServiceItems((items) =>
      items.filter((_, itemIndex) => itemIndex !== index)
    );
  }

  function applyServiceTemplate() {
    const template =
      SERVICE_TEMPLATES[salonBusinessType] ?? SERVICE_TEMPLATES.other;

    setServiceItems(template.map(createServiceRow));
    setServiceValidationError(null);
  }

  function validateServices() {
    if (serviceItems.length === 0) {
      return "Dodajte bar jednu uslugu.";
    }

    for (const service of serviceItems) {
      if (!service.name.trim()) {
        return "Naziv usluge je obavezan.";
      }

      if (
        !Number.isFinite(service.durationMinutes) ||
        service.durationMinutes < 5
      ) {
        return "Trajanje mora biti broj i najmanje 5 minuta.";
      }

      if (!Number.isFinite(service.priceAmount) || service.priceAmount < 0) {
        return "Cena mora biti broj i ne može biti negativna.";
      }
    }

    return null;
  }

  async function saveServices(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!existingSalonId) {
      setSubmitError("Please save basic salon information first.");
      return;
    }

    const validationError = validateServices();

    if (validationError) {
      setServiceValidationError(validationError);
      return;
    }

    setSubmitError(null);
    setServiceValidationError(null);
    setIsSavingServices(true);

    try {
      const existingServices = await getSalonServices(existingSalonId);
      const submittedIds = new Set(
        serviceItems
          .map((service) => service.id)
          .filter((serviceId): serviceId is string => Boolean(serviceId))
      );
      const servicesToDeactivate = existingServices.filter(
        (service) => !submittedIds.has(service.id)
      );
      const servicesToUpdate = serviceItems.filter((service) => service.id);
      const servicesToCreate = serviceItems.filter((service) => !service.id);

      for (const service of servicesToDeactivate) {
        await updateService({
          serviceId: service.id,
          name: service.name,
          description: service.description,
          categoryName: service.category_name,
          durationMinutes: service.duration_minutes,
          priceAmount: service.price,
          isActive: false,
          isPublic: false,
        });
      }

      for (const service of servicesToUpdate) {
        if (!service.id) continue;

        await updateService({
          serviceId: service.id,
          name: service.name.trim(),
          description: null,
          categoryName: null,
          durationMinutes: service.durationMinutes,
          priceAmount: service.priceAmount,
          isActive: true,
          isPublic: true,
        });
      }

      for (const service of servicesToCreate) {
        await createService({
          salonId: existingSalonId,
          name: service.name.trim(),
          description: null,
          categoryName: null,
          durationMinutes: service.durationMinutes,
          priceAmount: service.priceAmount,
          isActive: true,
          isPublic: true,
        });
      }

      const savedServices = await getSalonServices(existingSalonId);
      setServiceItems(buildServiceItems(savedServices, salonBusinessType));
      setServicesCount(
        savedServices.filter(
          (service) => service.is_active && service.is_public
        ).length
      );
      await updateOnboardingProgress(existingSalonId, 4);
      setCurrentStep(4);
    } catch (error) {
      console.error("Failed to save services:", error);
      setSubmitError("Something went wrong while saving services.");
    } finally {
      setIsSavingServices(false);
    }
  }

  return {
    addServiceItem,
    applyServiceTemplate,
    isSavingServices,
    removeServiceItem,
    saveServices,
    serviceItems,
    serviceValidationError,
    servicesCount,
    setServiceItems,
    setServicesCount,
    updateServiceItem,
    validateServices,
  };
}

