import type { Client, ClientStatus } from "@/types/client";

export function getClientInitials(client: Client) {
  return client.full_name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function getClientStatus(client: Client): ClientStatus {
  return client.status ?? "active";
}

export function getClientStatusLabel(client: Client) {
  return getClientStatus(client) === "active" ? "Aktivan" : "Neaktivan";
}

export function getClientSourceLabel(source: string | null) {
  if (!source) return "Manual";

  const labels: Record<string, string> = {
    ai: "AI",
    instagram: "Instagram",
    manual: "Manual",
    public: "Web",
    referral: "Preporuka",
    whatsapp: "WhatsApp",
  };

  return labels[source] ?? source;
}

export function formatClientDate(value: string | null | undefined) {
  if (!value) return "Nije dostupno";

  return new Intl.DateTimeFormat("sr-RS", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

export function formatMoney(value: number) {
  return new Intl.NumberFormat("sr-RS", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}
