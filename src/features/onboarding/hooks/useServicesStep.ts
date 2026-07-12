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
import { normalizeServiceName } from "../utils/onboardingValidators";
import type { Service } from "@/types/service";

type UseServicesStepParams = {
  existingSalonId: string | null;
  salonBusinessType: string;
  setCurrentStep: (step: number) => void;
  setSubmitError: (error: string | null) => void;
};

function findExistingServiceByName(services: Service[], name: string) {
  const normalizedName = normalizeServiceName(name);
  const matches = services.filter(
    (service) => normalizeServiceName(service.name) === normalizedName
  );

  return (
    matches.find((service) => service.is_active && service.is_public) ??
    matches[0]
  );
}

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

  async function applyServiceTemplate() {
    const template =
      SERVICE_TEMPLATES[salonBusinessType] ?? SERVICE_TEMPLATES.other;

    if (!existingSalonId) {
      setServiceItems(template.map(createServiceRow));
      setServiceValidationError(null);
      return;
    }

    try {
      const existingServices = await getSalonServices(existingSalonId);

      setServiceItems(
        template.map((service) => {
          const existingService = findExistingServiceByName(
            existingServices,
            service.name
          );

          return createServiceRow({
            id: existingService?.id,
            name: service.name,
            durationMinutes: service.durationMinutes,
            priceAmount: service.priceAmount,
          });
        })
      );
    } catch (error) {
      console.error("Failed to apply service template:", error);
      setSubmitError("Something went wrong while loading services template.");
    }

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

    const serviceNames = new Set<string>();

    for (const service of serviceItems) {
      const normalizedName = normalizeServiceName(service.name);

      if (serviceNames.has(normalizedName)) {
        return "Usluga sa ovim nazivom već postoji.";
      }

      serviceNames.add(normalizedName);
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
      const existingServicesById = new Map(
        existingServices.map((service) => [service.id, service])
      );
      const submittedIds = new Set<string>();

      for (const service of serviceItems) {
        if (service.id) {
          submittedIds.add(service.id);
          continue;
        }

        const existingService = findExistingServiceByName(
          existingServices,
          service.name
        );

        if (existingService) {
          submittedIds.add(existingService.id);
        }
      }

      const servicesToDeactivate = existingServices.filter(
        (service) => !submittedIds.has(service.id)
      );

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

      for (const service of serviceItems) {
        const existingService = service.id
          ? existingServicesById.get(service.id)
          : findExistingServiceByName(existingServices, service.name);

        if (existingService) {
          await updateService({
            serviceId: existingService.id,
            name: service.name.trim(),
            description: null,
            categoryName: null,
            durationMinutes: service.durationMinutes,
            priceAmount: service.priceAmount,
            isActive: true,
            isPublic: true,
          });
        } else {
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
