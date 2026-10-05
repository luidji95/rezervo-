import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
// Execute the production components with controlled hook scheduling and auth/fetch
// boundaries. This is a component logic test, not a browser/React renderer test.
function harness(path, name, dependencies = {}) {
  const slots = [];
  let cursor = 0;
  let dirty = true;
  let effects = [];
  let value;
  const logs = [];
  const same = (a, b) => a && b && a.length === b.length && a.every((item, i) => Object.is(item, b[i]));
  const memo = (factory, deps) => {
    const i = cursor++;
    if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { deps, value: factory() };
    return slots[i].value;
  };
  const react = {
    createContext: () => ({ Provider: "provider" }),
    useState: initial => {
      const i = cursor++;
      if (!slots[i]) slots[i] = { value: initial };
      return [slots[i].value, next => {
        const result = typeof next === "function" ? next(slots[i].value) : next;
        if (!Object.is(result, slots[i].value)) { slots[i].value = result; dirty = true; }
      }];
    },
    useRef: initial => memo(() => ({ current: initial }), []),
    useMemo: memo,
    useCallback: (fn, deps) => memo(() => fn, deps),
    useEffect: (fn, deps) => {
      const i = cursor++;
      if (!slots[i] || !same(slots[i].deps, deps)) {
        effects.push(() => { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; });
      }
    },
  };
  const jsx = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
  const componentModule = { exports: {} };
  const code = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const resolve = id => {
    if (id === "react") return react;
    if (id === "react/jsx-runtime") return jsx;
    if (id in dependencies) return dependencies[id];
    throw new Error(`Unexpected component dependency: ${id}`);
  };
  new Function("require", "module", "exports", "window", "fetch", "console", code)(
    resolve, componentModule, componentModule.exports, { setTimeout, clearTimeout }, dependencies.fetch,
    { info: (...args) => logs.push(args) },
  );
  return {
    logs,
    get tree() { return value; },
    get value() { return value.props.value; },
    render() { dirty = true; },
    async flush() {
      for (let i = 0; i < 20; i++) {
        if (dirty) {
          dirty = false; cursor = 0;
          value = componentModule.exports[name]({ children: null });
          const pending = effects; effects = []; pending.forEach(fn => fn());
        }
        await new Promise(resolve => setTimeout(resolve, 5));
        if (!dirty) return;
      }
      throw new Error("Component render/effect loop");
    },
    dispose() { slots.forEach(slot => slot.cleanup?.()); },
  };
}

const { loadEntitlements } = require("../src/features/billing/services/loadEntitlements.ts");
const entitlement = { isReadOnly: false };

test("visible retry button invokes the provider reload", async () => {
  let reloads = 0;
  const state = { loading: false, error: "UNAUTHORIZED", entitlements: null, refetchEntitlements: async () => { reloads++; } };
  const component = harness("src/features/billing/components/EntitlementStatus.tsx", "EntitlementStatus", {
    "../hooks/useEntitlements": { useEntitlements: () => state },
    "../services/entitlementLoadState": require("../src/features/billing/services/entitlementLoadState.ts"),
  });
  await component.flush();
  const button = component.tree.props.children.find(child => child.type === "button");
  button.props.onClick();
  assert.equal(reloads, 1);
  component.dispose();
});

test("scope changes discard old results but keep the current request; auth loading blocks fetch", async () => {
  const auth = { user: { id: "user" }, loading: true, accessToken: "synthetic-token" };
  const authorization = { currentSalon: { id: "first" }, loading: false };
  const pending = [];
  const provider = harness("src/features/billing/EntitlementsProvider.tsx", "EntitlementsProvider", {
    "@/context/AuthContext": { useAuth: () => auth },
    "@/context/AuthorizationContext": { useAuthorization: () => authorization },
    "./hooks/useEntitlements": { EntitlementsContext: { Provider: "provider" } },
    "./services/loadEntitlements": { loadEntitlements },
    fetch: () => new Promise(resolve => pending.push(resolve)),
  });
  try {
    await provider.flush();
    await provider.value.refetchEntitlements();
    assert.equal(pending.length, 0);
    auth.loading = false; provider.render(); await provider.flush();
    authorization.currentSalon = { id: "second" }; provider.render(); await provider.flush();
    assert.equal(pending.length, 2);
    pending[1](Response.json({ success: true, entitlements: { ...entitlement, planName: "current" } }));
    await provider.flush();
    pending[0](Response.json({ success: true, entitlements: { ...entitlement, planName: "obsolete" } }));
    await provider.flush();
    assert.equal(provider.value.entitlements.planName, "current");
    assert.equal(provider.value.loading, false);
  } finally { provider.dispose(); }
});

test("reproduces pre-fetch session failure; retry uses auth snapshot and mocked fetch", async () => {
  let requests = 0;
  const auth = { user: { id: "user" }, loading: false, accessToken: null };
  const authorization = { currentSalon: { id: "salon" }, loading: false };
  const provider = harness("src/features/billing/EntitlementsProvider.tsx", "EntitlementsProvider", {
    "@/context/AuthContext": { useAuth: () => auth },
    "@/context/AuthorizationContext": { useAuthorization: () => authorization },
    "./hooks/useEntitlements": { EntitlementsContext: { Provider: "provider" } },
    "./services/loadEntitlements": { loadEntitlements },
    fetch: async () => { requests++; return Response.json({ success: true, entitlements: entitlement }); },
    // No Supabase client dependency is supplied: an extra getSession import fails.
  });
  try {
    await provider.flush();
    assert.equal(requests, 0);
    assert.equal(provider.value.error, "UNAUTHORIZED");
    await provider.value.refetchEntitlements();
    await provider.flush();
    assert.equal(requests, 0);
    auth.accessToken = "synthetic-token";
    provider.render(); await provider.flush();
    assert.equal(requests, 1);
    assert.deepEqual(provider.value.entitlements, entitlement);
    // Recreated objects with the same identity must not invalidate/refetch.
    auth.user = { id: "user" };
    authorization.currentSalon = { id: "salon" };
    provider.render(); await provider.flush();
    assert.equal(requests, 1);
    await provider.value.refetchEntitlements(); await provider.flush();
    assert.equal(requests, 2);
    for (const [, fields] of provider.logs) {
      for (const [key, value] of Object.entries(fields)) assert.ok(key === "stage" || typeof value === "boolean");
    }
  } finally { provider.dispose(); }
});

test("token A to B for the same user/salon sends B and discards the late A response", async () => {
  const auth = { user: { id: "user" }, loading: false, accessToken: "token-A" };
  const authorization = { currentSalon: { id: "salon" }, loading: false };
  const pending = [];
  const provider = harness("src/features/billing/EntitlementsProvider.tsx", "EntitlementsProvider", {
    "@/context/AuthContext": { useAuth: () => auth },
    "@/context/AuthorizationContext": { useAuthorization: () => authorization },
    "./hooks/useEntitlements": { EntitlementsContext: { Provider: "provider" } },
    "./services/loadEntitlements": { loadEntitlements },
    fetch: (url, options) => new Promise(resolve => pending.push({ url, options, resolve })),
  });
  try {
    await provider.flush();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].options.headers.Authorization, "Bearer token-A");
    auth.accessToken = "token-B";
    provider.render(); await provider.flush();
    assert.equal(pending.length, 2);
    assert.equal(pending[1].url, pending[0].url);
    assert.equal(pending[1].options.headers.Authorization, "Bearer token-B");
    pending[1].resolve(Response.json({ success: true, entitlements: { ...entitlement, planName: "B" } }));
    await provider.flush();
    assert.equal(provider.value.entitlements.planName, "B");
    pending[0].resolve(Response.json({ success: true, entitlements: { ...entitlement, planName: "A" } }));
    await provider.flush();
    assert.equal(provider.value.entitlements.planName, "B");
    assert.equal(provider.value.loading, false);
    assert.equal(provider.value.error, null);
  } finally { provider.dispose(); }
});

// Connected provider logic via the controlled harness, not browser E2E.
test("connected AuthProvider sign-out clears entitlements and rejects a pending response", async () => {
  let callback;
  const session = { user: { id: "user" }, access_token: "synthetic-token" };
  const authProvider = harness("src/context/AuthContext.tsx", "AuthProvider", {
    "@/lib/supabase/client": { supabase: { auth: {
      getSession: async () => ({ data: { session }, error: null }),
      getUser: async () => ({ data: { user: session.user }, error: null }),
      onAuthStateChange: fn => { callback = fn; return { data: { subscription: { unsubscribe() {} } } }; },
    } } },
  });
  const pending = [];
  const provider = harness("src/features/billing/EntitlementsProvider.tsx", "EntitlementsProvider", {
    "@/context/AuthContext": { useAuth: () => authProvider.value },
    // Deliberately keep the old salon: auth sign-out must revoke access alone.
    "@/context/AuthorizationContext": { useAuthorization: () => ({ currentSalon: { id: "salon" }, loading: false }) },
    "./hooks/useEntitlements": { EntitlementsContext: { Provider: "provider" } },
    "./services/loadEntitlements": { loadEntitlements },
    fetch: () => new Promise(resolve => pending.push(resolve)),
  });
  try {
    await authProvider.flush();
    await provider.flush();
    pending[0](Response.json({ success: true, entitlements: entitlement }));
    await provider.flush();
    assert.deepEqual(provider.value.entitlements, entitlement);
    callback("SIGNED_OUT", null);
    await authProvider.flush(); provider.render(); await provider.flush();
    assert.equal(authProvider.value.accessToken, null);
    assert.equal(provider.value.entitlements, null);

    callback("SIGNED_IN", session);
    await authProvider.flush(); provider.render(); await provider.flush();
    assert.equal(pending.length, 2);
    callback("SIGNED_OUT", null);
    await authProvider.flush(); provider.render(); await provider.flush();
    assert.equal(provider.value.entitlements, null);
    pending[1](Response.json({ success: true, entitlements: entitlement }));
    await provider.flush();
    assert.equal(authProvider.value.user, null);
    assert.equal(authProvider.value.accessToken, null);
    assert.equal(provider.value.entitlements, null);
    await provider.value.refetchEntitlements(); await provider.flush();
    assert.equal(pending.length, 2);
    assert.equal(provider.value.entitlements, null);
  } finally { provider.dispose(); authProvider.dispose(); }
});

test("auth callback stays synchronous; late bootstrap cannot overwrite refresh or sign-out", async () => {
  let callback;
  let finishSession;
  let getUserCalls = 0;
  const provider = harness("src/context/AuthContext.tsx", "AuthProvider", {
    "@/lib/supabase/client": { supabase: { auth: {
      getSession: () => new Promise(resolve => { finishSession = resolve; }),
      getUser: async () => { getUserCalls++; throw new Error("must not validate obsolete session"); },
      onAuthStateChange: fn => { callback = fn; return { data: { subscription: { unsubscribe() {} } } }; },
    } } },
  });
  try {
    await provider.flush();
    assert.equal(provider.value.loading, true);
    assert.equal(callback("TOKEN_REFRESHED", { user: { id: "user" }, access_token: "new-token" }), undefined);
    await provider.flush();
    assert.equal(provider.value.accessToken, "new-token");
    callback("SIGNED_OUT", null);
    finishSession({ data: { session: { user: { id: "user" }, access_token: "old-token" } }, error: null });
    await provider.flush();
    assert.equal(provider.value.user, null);
    assert.equal(provider.value.accessToken, null);
    assert.equal(provider.value.loading, false);
    assert.equal(getUserCalls, 0);
  } finally { provider.dispose(); }
});

test("background user validation receives JWT directly and cannot replace a newer auth event", async () => {
  let callback;
  let finishValidation;
  let validatedWithToken = false;
  const provider = harness("src/context/AuthContext.tsx", "AuthProvider", {
    "@/lib/supabase/client": { supabase: { auth: {
      getSession: async () => ({ data: { session: { user: { id: "first" }, access_token: "first-token" } }, error: null }),
      getUser: token => { validatedWithToken = token === "first-token"; return new Promise(resolve => { finishValidation = resolve; }); },
      onAuthStateChange: fn => { callback = fn; return { data: { subscription: { unsubscribe() {} } } }; },
    } } },
  });
  try {
    await provider.flush();
    assert.equal(validatedWithToken, true);
    assert.equal(provider.value.loading, false);
    assert.equal(provider.value.accessToken, "first-token");
    callback("SIGNED_IN", { user: { id: "second" }, access_token: "second-token" });
    finishValidation({ data: { user: { id: "first" } }, error: null });
    await provider.flush();
    assert.equal(provider.value.user.id, "second");
    assert.equal(provider.value.accessToken, "second-token");
    for (const [, fields] of provider.logs) {
      for (const [key, value] of Object.entries(fields)) assert.ok(key === "stage" || typeof value === "boolean");
    }
  } finally { provider.dispose(); }
});
