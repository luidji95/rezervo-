"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import type { BillingOverview } from "../types/billingOverview";
import {
  INITIAL_PLAN_CHANGE_STATE,
  createPlanChangeController,
  type PlanChangeControllerState,
  type PlanChangeTransport,
} from "../services/billingPlanChangeController";

const transport: PlanChangeTransport = async (path, body) => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return { status: 401, body: { success: false, code: "BILLING_PLAN_CHANGE_UNAUTHORIZED" } };
  const headers: Record<string, string> = { Authorization: `Bearer ${session.access_token}` };
  if (body) headers["Content-Type"] = "application/json";
  const response = await fetch(path, { method: "POST", headers, body: body || undefined, cache: "no-store" });
  const parsed = await response.json().catch(() => null) as unknown;
  return parsed === null ? null : { status: response.status, body: parsed };
};

type Input = {
  /** user:salon identity; a change drops in-flight results and resets state. */
  scope: string | null;
  /** Current server overview; any fresh read may show the concrete outcome of an unclear request. */
  overview: BillingOverview | null;
  refreshOverview: () => Promise<BillingOverview | null>;
  refreshEntitlements: () => Promise<unknown>;
};

/**
 * C2 plan-change actions. requestChange() sends at most one request per click (single-flight) and
 * never retries; checkChange() calls only the status endpoint (provider read + evaluation, never a
 * change). Focus/visibility refreshes stay with useBillingStatusRefresh and do not call either.
 */
export function usePlanChange(input: Input) {
  const [state, setState] = useState<PlanChangeControllerState>(INITIAL_PLAN_CHANGE_STATE);
  const latest = useRef(input);
  useEffect(() => { latest.current = input; });
  const controller = useRef<ReturnType<typeof createPlanChangeController> | null>(null);

  useEffect(() => {
    const created = createPlanChangeController({
      transport,
      refreshOverview: () => latest.current.refreshOverview(),
      refreshEntitlements: () => latest.current.refreshEntitlements(),
      onState: setState,
    });
    controller.current = created;
    const reset = window.setTimeout(() => setState(INITIAL_PLAN_CHANGE_STATE), 0);
    return () => { window.clearTimeout(reset); created.dispose(); if (controller.current === created) controller.current = null; };
  }, [input.scope]);

  useEffect(() => { controller.current?.observeOverview(input.overview); }, [input.overview]);

  const requestChange = useCallback((targetPlan: "starter" | "pro") =>
    controller.current?.request(targetPlan, latest.current.overview?.planChange.current?.id ?? null) ?? Promise.resolve(), []);
  const checkChange = useCallback(() => controller.current?.check() ?? Promise.resolve(), []);
  return { ...state, requestChange, checkChange };
}
