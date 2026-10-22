"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import type { BillingOverview } from "../types/billingOverview";
import {
  getPlanChangeConfirmation,
  getPlanChangeStatusPresentation,
  getPlanChangeUnavailableMessage,
} from "../services/billingPlanChangePresentation";
import type { PlanChangeControllerState } from "../services/billingPlanChangeController";
import styles from "./BillingPreview.module.css";

type Props = {
  overview: BillingOverview;
  currentPlan: "starter" | "pro" | null;
  activeEmployees: number | null;
  actions: PlanChangeControllerState & { requestChange(target: "starter" | "pro"): Promise<void>; checkChange(): Promise<void> };
  confirmTarget: "starter" | "pro" | null;
  onConfirmTarget(target: "starter" | "pro" | null): void;
};

/** C2 plan change: current change status, explanations and the confirmation dialog. */
export function PlanChangePanel({ overview, currentPlan, activeEmployees, actions, confirmTarget, onConfirmTarget }: Props) {
  const planChange = overview.planChange;
  const status = planChange.current ? getPlanChangeStatusPresentation(planChange.current) : null;
  const unavailable = !planChange.current && !planChange.canRequest
    ? getPlanChangeUnavailableMessage(planChange, { activeEmployees, plans: overview.plans })
    : null;
  const confirmation = confirmTarget && currentPlan && planChange.canRequest && planChange.effectiveAt && confirmTarget === planChange.targetPlan
    ? getPlanChangeConfirmation({ currentPlan, targetPlan: confirmTarget, effectiveAt: planChange.effectiveAt, plans: overview.plans })
    : null;
  const busy = actions.submitting || actions.checking;
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!confirmation) return;
    cancelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !actions.submitting) onConfirmTarget(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmation, actions.submitting, onConfirmTarget]);

  if (!status && !unavailable && !actions.notice && !confirmation) return null;

  return <>
    {(status || actions.notice) && <section className={styles.planChangeCard} aria-labelledby="plan-change-title">
      <div>
        <h2 id="plan-change-title">Promena paketa</h2>
        {status && <p className={styles[`planChange_${status.tone}`]} role="status">{status.message}</p>}
        {status?.detail && <p className={styles.planChangeDetail}>{status.detail}</p>}
        {actions.notice && <p className={actions.notice.kind === "checked" ? styles.planChangeDetail : styles.checkoutError} role={actions.notice.kind === "checked" ? "status" : "alert"}>{actions.notice.message}</p>}
      </div>
      {planChange.canCheckStatus && <button type="button" className={styles.statusCheckButton} disabled={busy} aria-busy={actions.checking} onClick={() => void actions.checkChange()}>{actions.checking ? "Provera promene…" : "Proveri promenu"}</button>}
    </section>}
    {unavailable && <p className={styles.portalNote} role="status">{unavailable}{planChange.unavailableReason === "employees_over_target" && <> <Link href="/employees">Upravljajte zaposlenima</Link></>}</p>}
    {confirmation && <div className={styles.modalBackdrop} role="presentation" onMouseDown={() => !actions.submitting && onConfirmTarget(null)}>
      <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="plan-change-confirm-title" onMouseDown={(event) => event.stopPropagation()}>
        <h2 id="plan-change-confirm-title">{confirmation.title}</h2>
        <ul className={styles.confirmList}>{confirmation.lines.map((line) => <li key={line}>{line}</li>)}</ul>
        <div className={styles.modalActions}>
          <button ref={cancelRef} type="button" onClick={() => onConfirmTarget(null)} disabled={actions.submitting}>Odustani</button>
          <button type="button" className={styles.portalButton} disabled={actions.submitting || actions.locked} aria-busy={actions.submitting}
            onClick={() => { void actions.requestChange(confirmTarget!).finally(() => onConfirmTarget(null)); }}>
            {actions.submitting ? "Slanje zahteva…" : confirmation.confirmLabel}
          </button>
        </div>
      </div>
    </div>}
  </>;
}
