import type { WorkingHour } from "@/types/workingHour";

export const DAYS = [
  { value: 1, label: "Pon" },
  { value: 2, label: "Uto" },
  { value: 3, label: "Sre" },
  { value: 4, label: "ÄŒet" },
  { value: 5, label: "Pet" },
  { value: 6, label: "Sub" },
  { value: 0, label: "Ned" },
];

export function getInitials(name: string) {
  return name
    .split(" ")
    .map((part) => part.charAt(0))
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function formatDate(date: string) {
  return new Intl.DateTimeFormat("sr-RS", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(date));
}

export function formatTime(time?: string | null) {
  if (!time) return "";
  return time.slice(0, 5);
}

export function formatWorkingHour(hour?: WorkingHour) {
  if (!hour) return "NasleÄ‘eno";
  if (!hour.is_working_day) return "-";

  return `${formatTime(hour.opens_at)} - ${formatTime(hour.closes_at)}`;
}

export function getEmployeeMainWorkingTime(hours: WorkingHour[]) {
  const firstWorkingDay = hours.find((hour) => hour.is_working_day);

  if (!firstWorkingDay) return "-";

  return `${formatTime(firstWorkingDay.opens_at)} - ${formatTime(
    firstWorkingDay.closes_at
  )}`;
}

export function getDummyOccupancy(employeeId: string) {
  const value = employeeId.charCodeAt(0) % 25;
  return 70 + value;
}
