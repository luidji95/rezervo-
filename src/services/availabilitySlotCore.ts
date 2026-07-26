import { getTodayDateKey } from "../lib/salonDateTime.ts";

export const PUBLIC_BOOKING_MIN_NOTICE_MINUTES = 0;

export type AvailabilityTimeRange = { start: Date; end: Date };

type GenerateScheduleSlotsInput = {
  selectedDate: string;
  timeZone: string;
  workStart: Date;
  workEnd: Date;
  durationMinutes: number;
  unavailableRanges?: AvailabilityTimeRange[];
  now?: Date;
  minimumNoticeMinutes?: number;
};

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000);
}

export function availabilityRangesOverlap(
  first: AvailabilityTimeRange,
  second: AvailabilityTimeRange,
) {
  return first.start < second.end && first.end > second.start;
}

export function isSlotAllowedByCurrentTime(input: {
  slotStart: Date;
  selectedDate: string;
  timeZone: string;
  now?: Date;
  minimumNoticeMinutes?: number;
}) {
  const now = input.now ?? new Date();
  const today = getTodayDateKey(input.timeZone, now);

  if (input.selectedDate < today) return false;
  if (input.selectedDate > today) return true;

  const minimumStart = addMinutes(
    now,
    input.minimumNoticeMinutes ?? PUBLIC_BOOKING_MIN_NOTICE_MINUTES,
  );
  return input.slotStart >= minimumStart;
}

export function generateScheduleSlots({
  selectedDate,
  timeZone,
  workStart,
  workEnd,
  durationMinutes,
  unavailableRanges = [],
  now = new Date(),
  minimumNoticeMinutes = PUBLIC_BOOKING_MIN_NOTICE_MINUTES,
}: GenerateScheduleSlotsInput): AvailabilityTimeRange[] {
  if (durationMinutes <= 0 || workEnd <= workStart) return [];

  const slots: AvailabilityTimeRange[] = [];
  let slotStart = workStart;

  while (true) {
    const slotEnd = addMinutes(slotStart, durationMinutes);
    if (slotEnd > workEnd) break;

    const candidate = { start: slotStart, end: slotEnd };
    const isFutureSlot = isSlotAllowedByCurrentTime({
      slotStart,
      selectedDate,
      timeZone,
      now,
      minimumNoticeMinutes,
    });
    const hasConflict = unavailableRanges.some((range) =>
      availabilityRangesOverlap(candidate, range),
    );

    if (isFutureSlot && !hasConflict) slots.push(candidate);
    slotStart = slotEnd;
  }

  return slots;
}
