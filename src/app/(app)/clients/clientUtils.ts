import type { Client, ClientStatus } from "@/types/client";

const FAVORITE_SERVICES = [
  "Sisanje",
  "Farbanje",
  "Brada",
  "Pramenovi",
  "Feniranje",
];

const TAGS = ["VIP", "Veran klijent", "Rizican"];

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

export function getDummyVisits(clientId: string) {
  return 6 + (clientId.charCodeAt(0) % 10);
}

export function getDummySpent(clientId: string) {
  return 180 + (clientId.charCodeAt(1) % 8) * 45;
}

export function getDummyFavoriteService(clientId: string) {
  return FAVORITE_SERVICES[clientId.charCodeAt(2) % FAVORITE_SERVICES.length];
}

export function getDummyTag(clientId: string) {
  return TAGS[clientId.charCodeAt(3) % TAGS.length];
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
  return `€${value.toLocaleString("sr-RS")}`;
}

export function getDummyLastVisit(clientId: string) {
  const day = 8 + (clientId.charCodeAt(0) % 18);
  return `${String(day).padStart(2, "0")}.05.2025`;
}
