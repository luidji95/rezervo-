import type { BillingOverview } from "../types/billingOverview.ts";
import {
  PLAN_CHANGE_CHECK_FAILED_MESSAGE,
  PLAN_CHANGE_CHECKED_MESSAGE,
  PLAN_CHANGE_UNKNOWN_MESSAGE,
  getPlanChangeRequestErrorMessage,
} from "./billingPlanChangePresentation.ts";

export const PLAN_CHANGE_REQUEST_PATH = "/api/billing/plan-change";
export const PLAN_CHANGE_STATUS_PATH = "/api/billing/plan-change/status";

/** One HTTP call; null means no usable response (network failure, abort, unparsable body). */
export type PlanChangeTransport = (path: typeof PLAN_CHANGE_REQUEST_PATH | typeof PLAN_CHANGE_STATUS_PATH, body: string) =>
  Promise<{ status: number; body: unknown } | null>;

export type PlanChangeNotice = { kind: "unknown" | "error" | "check_failed" | "checked"; message: string };

export type PlanChangeControllerState = {
  submitting: boolean;
  checking: boolean;
  notice: PlanChangeNotice | null;
  /**
   * Set after an unknown outcome. The original request may still be running on the server, so the
   * absence of a change in an overview read proves nothing. The lock is lifted only when a fresh
   * overview shows a concrete transition other than the one known when the request was sent; until
   * then (or a full reload) no new request is offered in this user:salon context. The database still
   * prevents a second dispatch either way.
   */
  locked: boolean;
};

export const INITIAL_PLAN_CHANGE_STATE: PlanChangeControllerState = { submitting: false, checking: false, notice: null, locked: false };

type Dependencies = {
  transport: PlanChangeTransport;
  /** Local server re-reads (overview/entitlements). Never a plan-change request. */
  refreshOverview(): Promise<BillingOverview | null>;
  refreshEntitlements(): Promise<unknown>;
  onState(state: PlanChangeControllerState): void;
};


/**
 * Plan-change actions for one user:salon context. Single-flight per action; results that arrive after
 * dispose() (logout, user/salon change, unmount) are dropped. The status check only ever calls the
 * status endpoint; nothing here repeats a request automatically.
 */
export function createPlanChangeController(dependencies: Dependencies) {
  let state = INITIAL_PLAN_CHANGE_STATE;
  let disposed = false;
  let requestInFlight = false;
  let checkInFlight = false;
  /** Change id the overview showed when the unclear request was sent (undefined: no unclear request). */
  let lockedAgainst: string | null | undefined;
  const set = (patch: Partial<PlanChangeControllerState>) => {
    if (disposed) return;
    state = { ...state, ...patch };
    dependencies.onState(state);
  };

  /** Only a concrete transition (a change id other than the one known at send time) resolves the lock. */
  function releaseLockFrom(overview: BillingOverview | null) {
    const current = overview?.planChange.current;
    if (disposed || !state.locked || lockedAgainst === undefined || !current || current.id === lockedAgainst) return;
    lockedAgainst = undefined;
    set({ locked: false });
  }

  async function refreshAll() {
    const [overview] = await Promise.all([
      dependencies.refreshOverview().catch(() => null),
      dependencies.refreshEntitlements().catch(() => null),
    ]);
    if (!disposed) releaseLockFrom(overview);
    return overview;
  }

  async function request(targetPlan: "starter" | "pro", knownChangeId: string | null = null) {
    if (disposed || requestInFlight || checkInFlight || state.locked) return;
    requestInFlight = true;
    set({ submitting: true, notice: null });
    try {
      let response: Awaited<ReturnType<PlanChangeTransport>> = null;
      try { response = await dependencies.transport(PLAN_CHANGE_REQUEST_PATH, JSON.stringify({ targetPlan })); } catch { response = null; }
      if (disposed) return;
      const body = response?.body as { success?: unknown; outcome?: unknown; code?: unknown } | null | undefined;
      const knownError = response && body?.success === false ? getPlanChangeRequestErrorMessage(body.code) : null;
      if (response && body?.success === true && (body.outcome === "requested" || body.outcome === "already_pending")) {
        // The server view is re-read below; the POST body is never treated as completion or payment.
        set({ notice: null });
      } else if (knownError) {
        // Codes returned only before any provider mutation: nothing was sent.
        set({ notice: { kind: "error", message: knownError } });
      } else {
        // Lost response, status_unknown, 5xx or anything unrecognised: the intent may be recorded.
        lockedAgainst = knownChangeId;
        set({ notice: { kind: "unknown", message: PLAN_CHANGE_UNKNOWN_MESSAGE }, locked: true });
      }
      await refreshAll();
    } finally {
      requestInFlight = false;
      set({ submitting: false });
    }
  }

  async function check() {
    if (disposed || checkInFlight || requestInFlight) return;
    checkInFlight = true;
    set({ checking: true });
    try {
      let response: Awaited<ReturnType<PlanChangeTransport>> = null;
      try { response = await dependencies.transport(PLAN_CHANGE_STATUS_PATH, ""); } catch { response = null; }
      if (disposed) return;
      const ok = (response?.body as { success?: unknown } | undefined)?.success === true;
      const overview = await refreshAll();
      if (disposed) return;
      set({ notice: ok && overview ? { kind: "checked", message: PLAN_CHANGE_CHECKED_MESSAGE } : { kind: "check_failed", message: PLAN_CHANGE_CHECK_FAILED_MESSAGE } });
    } finally {
      checkInFlight = false;
      set({ checking: false });
    }
  }

  return {
    request,
    check,
    getState: () => state,
    /** Any later local overview read (e.g. the B2 focus refresh) may show the concrete transition. */
    observeOverview: (overview: BillingOverview | null) => releaseLockFrom(overview),
    dispose() { disposed = true; },
  };
}
