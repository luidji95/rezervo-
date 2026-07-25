"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuthorization } from "@/context/AuthorizationContext";
import { supabase } from "@/lib/supabase/client";
import type {
  ReminderSettingsErrorCode,
  ReminderSettingsOverview,
} from "../types/reminderSettingsOverview";

type ApiResponse =
  | { success: true; overview: ReminderSettingsOverview }
  | { success: false; code?: ReminderSettingsErrorCode };

async function requestHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("UNAUTHORIZED");
  return { Authorization: `Bearer ${session.access_token}` };
}

export function useReminderSettings() {
  const { currentSalon, loading: authorizationLoading } = useAuthorization();
  const [overview, setOverview] = useState<ReminderSettingsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ReminderSettingsErrorCode | null>(null);

  const load = useCallback(async () => {
    if (!currentSalon) {
      setOverview(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const headers = await requestHeaders();
      const response = await fetch(`/api/reminders/settings?salonId=${encodeURIComponent(currentSalon.id)}`, {
        headers,
        cache: "no-store",
      });
      const body = await response.json().catch(() => null) as ApiResponse | null;
      if (!response.ok || !body?.success) throw new Error(body && !body.success ? body.code : "REMINDER_SETTINGS_LOAD_FAILED");
      setOverview(body.overview);
    } catch (loadError) {
      setOverview(null);
      setError((loadError instanceof Error ? loadError.message : "REMINDER_SETTINGS_LOAD_FAILED") as ReminderSettingsErrorCode);
    } finally {
      setLoading(false);
    }
  }, [currentSalon]);

  useEffect(() => {
    if (authorizationLoading) return;
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, [authorizationLoading, load]);

  const save = useCallback(async (input: { enabled: boolean; hoursBefore: number }) => {
    if (!currentSalon) return { ok: false as const, code: "FORBIDDEN" as ReminderSettingsErrorCode };
    setSaving(true);
    setError(null);
    try {
      const headers = await requestHeaders();
      const response = await fetch(`/api/reminders/settings?salonId=${encodeURIComponent(currentSalon.id)}`, {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const body = await response.json().catch(() => null) as ApiResponse | null;
      if (!response.ok || !body?.success) {
        const code = body && !body.success && body.code ? body.code : "REMINDER_SETTINGS_SAVE_FAILED";
        setError(code);
        return { ok: false as const, code };
      }
      setOverview(body.overview);
      return { ok: true as const, overview: body.overview };
    } catch {
      setError("REMINDER_SETTINGS_SAVE_FAILED");
      return { ok: false as const, code: "REMINDER_SETTINGS_SAVE_FAILED" as const };
    } finally {
      setSaving(false);
    }
  }, [currentSalon]);

  return {
    overview,
    loading: authorizationLoading || loading,
    usageLoading: authorizationLoading || loading,
    saving,
    error,
    retry: load,
    save,
    salonName: currentSalon?.name ?? "Vaš salon",
  };
}
