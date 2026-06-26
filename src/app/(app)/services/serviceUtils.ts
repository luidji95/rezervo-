import type { Service } from "@/types/service";

export const DEFAULT_SERVICE_CATEGORIES = [
  "Šišanje",
  "Farbanje",
  "Pramenovi",
  "Brada",
  "Nadogradnja",
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

export function formatMoney(value: number) {
  return new Intl.NumberFormat("sr-RS", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatServiceDate(value: string | null | undefined) {
  if (!value) return "Nema rezervacija";

  return new Intl.DateTimeFormat("sr-RS", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}
