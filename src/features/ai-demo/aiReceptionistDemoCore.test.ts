import assert from "node:assert/strict";
import test from "node:test";
import {
  DEMO_BUSY,
  DEMO_SERVICE,
  DEMO_SLOTS,
  addMinutes,
  chooseDemoOption,
  createDemoState,
  getDemoBooking,
  getDemoChoices,
  tomorrowInBelgrade,
  type DemoState,
  type EmployeeId,
} from "./aiReceptionistDemoCore.ts";

const NOW = new Date("2026-11-09T10:00:00Z");
const run = (...choices: string[]) => choices.reduce<DemoState>((state, choice) => {
  const next = chooseDemoOption(state, choice);
  assert.notEqual(next, state, `choice ${choice} must be offered at step ${state.step}`);
  return next;
}, createDemoState(NOW));
const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));

test("tomorrow is computed in Europe/Belgrade, also around midnight and DST", () => {
  // 23:30 UTC on 9 Nov is already 10 Nov in Belgrade (UTC+1), so tomorrow is 11 Nov.
  assert.equal(tomorrowInBelgrade(new Date("2026-11-09T23:30:00Z")).dateKey, "2026-11-11");
  assert.equal(tomorrowInBelgrade(new Date("2026-11-09T22:30:00Z")).dateKey, "2026-11-10");
  assert.equal(tomorrowInBelgrade(new Date("2026-12-31T12:00:00Z")).dateKey, "2027-01-01");
  assert.equal(tomorrowInBelgrade(new Date("2026-03-28T23:30:00Z")).dateKey, "2026-03-30");
  assert.equal(tomorrowInBelgrade(new Date("2026-11-09T10:00:00Z")).label, "utorak, 10. novembra");
});

test("main flow with a chosen employee ends only after confirmation and matches the review", () => {
  const review = run("ask-haircut", "employee:ana", "slot:ana:13:30", "contact-ok");
  assert.equal(review.step, "review");
  assert.equal(getDemoChoices(review).map((choice) => choice.id).join(","), "confirm,change-time");
  const done = chooseDemoOption(review, "confirm");
  assert.equal(done.step, "done");
  const booking = getDemoBooking(done)!;
  assert.deepEqual([booking.employeeId, booking.time, booking.endTime, booking.dateKey, booking.priceRsd, booking.durationMinutes],
    ["ana", "13:30", "14:15", "2026-11-10", DEMO_SERVICE.priceRsd, DEMO_SERVICE.durationMinutes]);
  const reviewText = review.messages.at(-1)!.text;
  for (const part of ["kod Ane", "13:30", "45 min", "1.800 RSD", "utorak, 10. novembra"]) assert.ok(reviewText.includes(part), `review mentions ${part}`);
  assert.ok(done.messages.at(-1)!.text.includes("13:30") && done.messages.at(-1)!.text.includes("kod Ane"));
  assert.deepEqual(getDemoChoices(done), []);
});

test("'Svejedno mi je' offers at most three slots from both employees and keeps the chosen employee", () => {
  const slotStep = run("ask-haircut", "employee:any");
  const offered = getDemoChoices(slotStep);
  const slots = offered.filter((choice) => choice.id.startsWith("slot:"));
  assert.ok(slots.length >= 2 && slots.length <= 3);
  assert.ok(new Set(slots.map((choice) => choice.id.split(":")[1])).size === 2, "both employees offered");
  const marko = slots.find((choice) => choice.id.startsWith("slot:marko:"))!;
  const done = run("ask-haircut", "employee:any", marko.id, "contact-ok", "confirm");
  assert.equal(getDemoBooking(done)!.employeeId, "marko");
  assert.ok(done.messages.at(-1)!.text.includes("kod Marka"));
});

test("price question answers price and duration, then returns to the same slots once", () => {
  const before = run("ask-haircut", "employee:marko");
  const afterPrice = chooseDemoOption(before, "ask-price");
  assert.equal(afterPrice.step, "slot");
  assert.ok(afterPrice.messages.at(-1)!.text.includes("45 minuta") && afterPrice.messages.at(-1)!.text.includes("1.800 RSD"));
  const slotIds = (state: DemoState) => getDemoChoices(state).filter((choice) => choice.id.startsWith("slot:")).map((choice) => choice.id);
  assert.deepEqual(slotIds(afterPrice), slotIds(before));
  assert.ok(!getDemoChoices(afterPrice).some((choice) => choice.id === "ask-price"), "price offered once");
  assert.equal(chooseDemoOption(afterPrice, "ask-price"), afterPrice, "repeated price question ignored");
});

test("changing the time from contact or review keeps the employee and updates the final booking", () => {
  const review = run("ask-haircut", "employee:ana", "slot:ana:10:00", "contact-ok");
  const back = chooseDemoOption(review, "change-time");
  assert.equal(back.step, "slot");
  assert.equal(back.slot, null);
  const done = run("ask-haircut", "employee:ana", "slot:ana:10:00", "contact-ok", "change-time", "slot:ana:17:00", "contact-ok", "confirm");
  assert.equal(getDemoBooking(done)!.time, "17:00");
  assert.ok(done.messages.at(-1)!.text.includes("17:00"));
});

test("stale or repeated choices change nothing (double clicks)", () => {
  const employeeStep = run("ask-haircut");
  assert.equal(chooseDemoOption(employeeStep, "ask-haircut"), employeeStep);
  assert.equal(chooseDemoOption(employeeStep, "confirm"), employeeStep);
  const slotStep = chooseDemoOption(employeeStep, "employee:ana");
  assert.equal(chooseDemoOption(slotStep, "slot:marko:11:15"), slotStep, "slot of another employee not offered");
  assert.equal(chooseDemoOption(slotStep, "employee:marko"), slotStep);
  const ids = slotStep.messages.map((message) => message.id);
  assert.equal(new Set(ids).size, ids.length, "message ids unique");
});

test("free slots never overlap busy blocks and fit the service duration", () => {
  for (const employeeId of Object.keys(DEMO_SLOTS) as EmployeeId[]) {
    for (const slot of DEMO_SLOTS[employeeId]) {
      const start = toMinutes(slot);
      const end = toMinutes(addMinutes(slot, DEMO_SERVICE.durationMinutes));
      for (const busy of DEMO_BUSY[employeeId]) {
        assert.ok(end <= toMinutes(busy.start) || start >= toMinutes(busy.end), `${employeeId} ${slot} overlaps ${busy.start}`);
      }
    }
  }
});
