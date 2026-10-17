"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BillingOverview } from "../types/billingOverview";
import type { SalonEntitlements } from "../types/entitlements";
import { billingStatusKey, createRefreshGate, resolveRefreshOutcome, type RefreshOutcome, type RefreshTrigger } from "../services/billingStatusRefresh";

type Input = {
  /** user:salon identity; refresh state is discarded when it changes. */
  scope: string | null;
  entitlements: SalonEntitlements | null;
  overview: BillingOverview | null;
  refreshEntitlements: () => Promise<SalonEntitlements | null>;
  refreshOverview: () => Promise<BillingOverview | null>;
};

/**
 * Re-reads server-owned billing state after returning from the payment provider or on request.
 * A return event is never treated as proof of any change: only freshly read server data is reported.
 * No polling and no timers: automatic refreshes happen at most once per throttle window on return events.
 */
export function useBillingStatusRefresh(input: Input) {
  const [checking, setChecking] = useState(false);
  const [outcome, setOutcome] = useState<RefreshOutcome | null>(null);
  const latest = useRef(input);
  const gate = useRef(createRefreshGate());

  useEffect(() => { latest.current = input; });
  useEffect(() => {
    gate.current = createRefreshGate();
    const reset = window.setTimeout(() => { setChecking(false); setOutcome(null); }, 0);
    return () => window.clearTimeout(reset);
  }, [input.scope]);

  const run = useCallback(async (trigger: RefreshTrigger) => {
    const currentGate = gate.current;
    if (!currentGate.tryStart(trigger)) return;
    const startScope = latest.current.scope;
    const before = billingStatusKey(latest.current.entitlements, latest.current.overview);
    setChecking(true);
    try {
      const [entitlements, overview] = await Promise.all([latest.current.refreshEntitlements(), latest.current.refreshOverview()]);
      if (gate.current !== currentGate || latest.current.scope !== startScope) return;
      const result = resolveRefreshOutcome(before, { entitlements, overview });
      // Silent return events only surface a real change; manual checks always report.
      if (trigger === "manual" || result === "changed") setOutcome(result);
    } finally {
      currentGate.finish();
      if (gate.current === currentGate) setChecking(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const onReturn = () => { if (active && document.visibilityState === "visible") void run("return"); };
    const onPageShow = (event: PageTransitionEvent) => { if (event.persisted) onReturn(); };
    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("focus", onReturn);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("focus", onReturn);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [run]);

  return { checking, outcome, checkStatus: useCallback(() => run("manual"), [run]) };
}
