"use client";

import { useEffect, useState } from "react";
import { hasAppointmentEnded } from "./appointmentOutcomeTiming";

// Re-renders once the end time passes so a disabled action becomes available without a reload.
export function useAppointmentEnded(endTime: string | null | undefined) {
  const [ended, setEnded] = useState(() => (endTime ? hasAppointmentEnded(endTime) : false));
  useEffect(() => {
    if (!endTime) return;
    const remaining = new Date(endTime).getTime() - Date.now();
    if (!Number.isFinite(remaining)) return;
    const sync = () => setEnded(hasAppointmentEnded(endTime));
    sync();
    if (remaining <= 0) return;
    const timer = setTimeout(sync, Math.min(remaining + 500, 2_147_000_000));
    return () => clearTimeout(timer);
  }, [endTime]);
  return endTime ? ended : false;
}
