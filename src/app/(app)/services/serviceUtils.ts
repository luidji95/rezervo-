import type { Service } from "@/types/service";

export const DEFAULT_SERVICE_CATEGORIES = [
  "Šišanje",
  "Farbanje",
  "Pramenovi",
  "Brada",
  "Nadogradnja",
];

export const SERVICE_INCLUDED_ITEMS = [
  "Pranje kose",
  "Šišanje",
  "Feniranje",
  "Saveti za održavanje",
];

export function getServiceCategory(service: Service) {
  return service.category_name || "Bez kategorije";
}

export function formatDuration(minutes: number) {
  return `${minutes} min`;
}

export function formatPrice(service: Service) {
  const value = Number(service.price);
  const currency = service.currency || "€";

  if (currency === "EUR" || currency === "€") {
    return `€${value.toLocaleString("sr-RS")}`;
  }

  return `${value.toLocaleString("sr-RS")} ${currency}`;
}

export function getDummyPopularity(serviceId: string) {
  const value = serviceId.charCodeAt(0) % 24;
  return 28 + value;
}

export function getAverageDuration(services: Service[]) {
  if (services.length === 0) return 0;

  const total = services.reduce(
    (sum, service) => sum + service.duration_minutes,
    0
  );

  return Math.round(total / services.length);
}
