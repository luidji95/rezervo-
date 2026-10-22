import assert from "node:assert/strict";
import test from "node:test";

import {
  PLAN_CHANGE_REQUEST_PATH,
  PLAN_CHANGE_STATUS_PATH,
  createPlanChangeController,
  type PlanChangeControllerState,
  type PlanChangeTransport,
} from "./billingPlanChangeController.ts";
import { UNAVAILABLE_PLAN_CHANGE_OVERVIEW } from "./billingPlanChangePresentation.ts";
import type { BillingOverview } from "../types/billingOverview.ts";
import type { PlanChangeView } from "../types/planChange.ts";

const overview = (current: PlanChangeView | null, canRequest = false): BillingOverview => ({
  billingEnvironment: "test", canOpenCustomerPortal: false, portalUnavailableReason: "not_applicable", canStartCheckout: false,
  plans: [], usage: { activeEmployees: 1 },
  planChange: { ...UNAVAILABLE_PLAN_CHANGE_OVERVIEW, canRequest, unavailableReason: canRequest ? null : "pending", targetPlan: canRequest ? "pro" : null, effectiveAt: canRequest ? "2027-03-31T00:00:00Z" : null, current },
});
const pending: PlanChangeView = { id: "c1", state: "pending_confirmation", direction: "upgrade", targetPlan: "pro", effectiveAt: "2027-03-31T00:00:00Z", nextAction: "check_status_later" };

function setup(options: { respond?: PlanChangeTransport; overviewAfter?: BillingOverview | null } = {}) {
  const calls: { path: string; body: string }[] = [];
  const states: PlanChangeControllerState[] = [];
  let refreshes = 0;
  const controller = createPlanChangeController({
    transport: async (path, body) => { calls.push({ path, body }); return options.respond ? options.respond(path, body) : { status: 202, body: { success: true, outcome: "requested", planChange: pending } }; },
    refreshOverview: async () => { refreshes += 1; return options.overviewAfter === undefined ? overview(pending) : options.overviewAfter; },
    refreshEntitlements: async () => null,
    onState: (state) => states.push(state),
  });
  return { controller, calls, states, refreshes: () => refreshes };
}

test("multiple clicks send one request; the body carries only the target plan", async () => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const { controller, calls } = setup({ respond: async () => { await gate; return { status: 202, body: { success: true, outcome: "requested" } }; } });
  const first = controller.request("pro");
  void controller.request("pro");
  void controller.request("starter");
  release();
  await first;
  assert.deepEqual(calls, [{ path: PLAN_CHANGE_REQUEST_PATH, body: '{"targetPlan":"pro"}' }]);
});

test("accepted response re-reads the server view and claims nothing itself", async () => {
  const { controller, refreshes } = setup();
  await controller.request("pro");
  assert.equal(refreshes(), 1);
  assert.equal(controller.getState().notice, null);
  assert.equal(controller.getState().locked, false);
});

test("lost response or unknown outcome: do-not-repeat notice, locked, local refresh, never a second POST", async () => {
  for (const respond of [async () => null, async () => { throw new Error("network"); }, async () => ({ status: 202, body: { success: true, outcome: "status_unknown" } }), async () => ({ status: 500, body: { success: false, code: "BILLING_PLAN_CHANGE_INTERNAL_ERROR" } })] as PlanChangeTransport[]) {
    const { controller, calls, refreshes } = setup({ respond, overviewAfter: overview(null, true) });
    await controller.request("pro");
    assert.equal(controller.getState().notice?.kind, "unknown");
    assert.match(controller.getState().notice?.message ?? "", /Nemojte ponavljati zahtev/);
    assert.equal(controller.getState().locked, true);
    assert.equal(refreshes(), 1);
    await controller.request("pro");
    assert.equal(calls.filter((call) => call.path === PLAN_CHANGE_REQUEST_PATH).length, 1, "locked: no second request");
  }
});

test("race: the original request is still running when the overview reads no change; the lock holds", async () => {
  // 1-3. confirmed, original POST still running server-side, browser loses the response
  // 4. the overview is read before the intent is committed: no change, and the offer would be back
  const transportCalls: string[] = [];
  const controller = createPlanChangeController({
    transport: async (path) => { transportCalls.push(path); return null; },
    refreshOverview: async () => overview(null, true),
    refreshEntitlements: async () => null,
    onState: () => undefined,
  });
  await controller.request("pro", null);
  assert.deepEqual([controller.getState().locked, controller.getState().notice?.kind], [true, "unknown"], "absence of a change is not proof");
  await controller.request("pro", null);
  assert.equal(transportCalls.filter((path) => path === PLAN_CHANGE_REQUEST_PATH).length, 1, "no second POST while locked");
  // more reads without a change (B2 focus refresh) keep the lock
  controller.observeOverview(overview(null, true));
  assert.equal(controller.getState().locked, true);
  // 5. the original request commits later; the next local read shows the concrete transition
  controller.observeOverview(overview({ ...pending, id: "change-new" }));
  assert.equal(controller.getState().locked, false);
  assert.equal(transportCalls.filter((path) => path === PLAN_CHANGE_REQUEST_PATH).length, 1, "never an automatic second POST");
  assert.equal(transportCalls.includes(PLAN_CHANGE_STATUS_PATH), false, "refreshes never call the status endpoint");
});

test("an older change already visible at send time does not release the lock", async () => {
  const older: PlanChangeView = { ...pending, id: "change-old", state: "completed", nextAction: "none" };
  const { controller } = setup({ respond: async () => null, overviewAfter: overview(older, true) });
  await controller.request("pro", "change-old");
  assert.equal(controller.getState().locked, true);
  controller.observeOverview(overview(older, true));
  assert.equal(controller.getState().locked, true);
});

test("an explicit status check can surface the late transition and release the lock (status endpoint only)", async () => {
  let committed = false;
  const calls: string[] = [];
  const controller = createPlanChangeController({
    transport: async (path) => { calls.push(path); return path === PLAN_CHANGE_STATUS_PATH ? { status: 200, body: { success: true, outcome: "current" } } : null; },
    refreshOverview: async () => (committed ? overview({ ...pending, id: "change-new", state: "scheduled" }) : overview(null, true)),
    refreshEntitlements: async () => null,
    onState: () => undefined,
  });
  await controller.request("pro", null);
  assert.equal(controller.getState().locked, true);
  committed = true;
  await controller.check();
  assert.deepEqual(calls, [PLAN_CHANGE_REQUEST_PATH, PLAN_CHANGE_STATUS_PATH]);
  assert.equal(controller.getState().locked, false);
});

test("pre-dispatch error codes show a message without locking", async () => {
  const { controller } = setup({ respond: async () => ({ status: 409, body: { success: false, code: "BILLING_PLAN_CHANGE_RENEWAL_TOO_CLOSE" } }), overviewAfter: overview(null) });
  await controller.request("pro");
  assert.deepEqual([controller.getState().notice?.kind, controller.getState().locked], ["error", false]);
});

test("status check calls only the status endpoint and refreshes; failure keeps data and is marked", async () => {
  const ok = setup({ respond: async () => ({ status: 200, body: { success: true, outcome: "current" } }) });
  await ok.controller.check();
  assert.deepEqual(ok.calls.map((call) => call.path), [PLAN_CHANGE_STATUS_PATH]);
  assert.equal(ok.calls[0].body, "");
  assert.equal(ok.controller.getState().notice?.kind, "checked");
  const failed = setup({ respond: async () => null });
  await failed.controller.check();
  assert.equal(failed.controller.getState().notice?.kind, "check_failed");
  assert.equal(failed.calls.some((call) => call.path === PLAN_CHANGE_REQUEST_PATH), false);
});

test("results after dispose (logout, user/salon change, unmount) are dropped", async () => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const { controller, states, refreshes } = setup({ respond: async () => { await gate; return null; } });
  const pendingRequest = controller.request("pro");
  const before = states.length;
  controller.dispose();
  release();
  await pendingRequest;
  assert.equal(states.length, before, "no state change after dispose");
  assert.equal(refreshes(), 0, "no refresh for a stale context");
});
