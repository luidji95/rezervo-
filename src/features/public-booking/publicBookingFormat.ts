import type { PublicAvailabilitySlot, PublicService } from "./types.ts";

// Pure formatting and grouping helpers for the public booking UI (Latin script, salon time zone).
const LOCALE = "sr-Latn-RS";

export function formatPrice(price: number, currency: string) {
  try {
    return new Intl.NumberFormat(LOCALE, { style: "currency", currency, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(price);
  } catch {
    return `${price.toLocaleString(LOCALE)} ${currency}`;
  }
}

export function formatTime(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat(LOCALE, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(new Date(iso));
}

export function formatTimeRange(slot: PublicAvailabilitySlot, timeZone: string) {
  return `${formatTime(slot.startTime, timeZone)} – ${formatTime(slot.endTime, timeZone)}`;
}

// Date keys are YYYY-MM-DD in the salon time zone; noon UTC keeps the calendar day stable in any zone.
const keyToDate = (dateKey: string) => new Date(`${dateKey}T12:00:00Z`);

export function addDaysToDateKey(dateKey: string, days: number) {
  const date = keyToDate(dateKey);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function formatDateLong(dateKey: string) {
  const text = new Intl.DateTimeFormat(LOCALE, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(keyToDate(dateKey));
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function formatDateShort(dateKey: string) {
  const text = new Intl.DateTimeFormat(LOCALE, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(keyToDate(dateKey));
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function getDayParts(dateKey: string) {
  const date = keyToDate(dateKey);
  const weekday = new Intl.DateTimeFormat(LOCALE, { weekday: "short", timeZone: "UTC" }).format(date).replace(".", "");
  const month = new Intl.DateTimeFormat(LOCALE, { month: "short", timeZone: "UTC" }).format(date).replace(".", "");
  return { weekday: weekday.charAt(0).toUpperCase() + weekday.slice(1), day: date.getUTCDate(), month: month.toUpperCase() };
}

export function formatMonthYear(dateKey: string) {
  const text = new Intl.DateTimeFormat(LOCALE, { month: "long", year: "numeric", timeZone: "UTC" }).format(keyToDate(dateKey)).replace(/(\s*god)?\.?$/, "");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function getDayWindow(startKey: string, length = 7) {
  return Array.from({ length }, (_, index) => addDaysToDateKey(startKey, index));
}

export function groupSlotsByDayPart(slots: PublicAvailabilitySlot[], timeZone: string) {
  const morning: PublicAvailabilitySlot[] = [];
  const afternoon: PublicAvailabilitySlot[] = [];
  for (const slot of slots) {
    const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone }).format(new Date(slot.startTime)));
    (hour < 12 ? morning : afternoon).push(slot);
  }
  return { morning, afternoon };
}

export type ServiceCategoryFilter = { id: string; name: string };

// Filters are shown only when the real data has at least two distinct categories.
export function getServiceCategoryFilters(services: PublicService[]): ServiceCategoryFilter[] {
  const seen = new Map<string, string>();
  for (const service of services) if (service.categoryId && service.categoryName && !seen.has(service.categoryId)) seen.set(service.categoryId, service.categoryName);
  return seen.size >= 2 ? [...seen].map(([id, name]) => ({ id, name })) : [];
}
