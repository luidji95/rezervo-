import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync("src/app/api/appointments/[id]/notification/route.ts", "utf8");

test("appointment notification is an independently authorized full-access mutation", () => {
  const accessCheck = route.indexOf('"resolve_salon_access_v1"');
  const insert = route.indexOf("createNotification({");
  assert.ok(accessCheck >= 0);
  assert.ok(insert > accessCheck);
  assert.match(route, /access\?\.has_full_access !== true/);
  assert.match(route, /APPOINTMENT_ACCESS_REQUIRED/);
  assert.match(route, /\{ p_salon_id: appointment\.salon_id \}/);
});

test("access error, empty result and read-only result all return before notification insertion", () => {
  const guard = route.match(/if \(accessError \|\| access\?\.has_full_access !== true\) \{[\s\S]*?\n  \}/)?.[0];
  assert.ok(guard);
  assert.match(guard, /return response\("APPOINTMENT_ACCESS_REQUIRED", 403\)/);

  const denied = (error: unknown, rows: { has_full_access: boolean }[] | null) => {
    const access = rows?.[0];
    return Boolean(error) || access?.has_full_access !== true;
  };
  assert.equal(denied(new Error("controlled"), [{ has_full_access: true }]), true);
  assert.equal(denied(null, null), true);
  assert.equal(denied(null, []), true);
  assert.equal(denied(null, [{ has_full_access: false }]), true);
  assert.equal(denied(null, [{ has_full_access: true }]), false);

  assert.ok(route.indexOf(guard) < route.indexOf("EVENT_STATUS_MISMATCH"));
  assert.ok(route.indexOf(guard) < route.indexOf("createNotification({"));
});

test("browser controls only a strict event type and cannot inject notification authority", () => {
  assert.match(route, /z\.object\(\{[\s\S]*eventType: z\.enum\(\[/);
  assert.match(route, /\}\)\.strict\(\)/);
  for (const forbidden of ["salonId:", "recipientId:", "title:", "providerId:"]) {
    assert.doesNotMatch(route.slice(0, route.indexOf("const eventConfig")), new RegExp(forbidden));
  }
});

test("event state validation and deterministic duplicate lookup precede insertion", () => {
  const statusValidation = route.indexOf("EVENT_STATUS_MISMATCH");
  const duplicateLookup = route.indexOf('.from("notifications")');
  const insert = route.indexOf("createNotification({");
  assert.ok(statusValidation >= 0 && duplicateLookup > statusValidation && insert > duplicateLookup);
  assert.match(route, /appointment_rescheduled[\s\S]*duplicateQuery\.gte\("created_at", appointment\.updated_at\)/);
});
