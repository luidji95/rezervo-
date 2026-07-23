import type { StatisticsGranularity } from "./types";

export function formatStatisticsCurrency(value: number, currency: string) {
  return new Intl.NumberFormat("sr-RS", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatStatisticsNumber(value: number) {
  return new Intl.NumberFormat("sr-RS").format(value);
}

export function formatStatisticsDate(dateKey: string) {
  return new Intl.DateTimeFormat("sr-RS", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${dateKey}T12:00:00Z`));
}

export function formatStatisticsBucket(
  bucket: string,
  granularity: StatisticsGranularity,
) {
  if (granularity === "month") {
    return new Intl.DateTimeFormat("sr-RS", {
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${bucket}-01T12:00:00Z`));
  }
  return new Intl.DateTimeFormat("sr-RS", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${bucket}T12:00:00Z`));
}

const SOURCE_LABELS: Record<string, string> = {
  manual: "Ručno",
  public: "Online rezervacija",
  ai: "AI receptionist",
  whatsapp: "WhatsApp",
  instagram: "Instagram",
};

export function formatBookingSource(source: string) {
  return (
    SOURCE_LABELS[source] ??
    source.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase())
  );
}
