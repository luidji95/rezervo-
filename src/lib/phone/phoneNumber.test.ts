import test from "node:test";
import assert from "node:assert/strict";
import { PHONE_CASES } from "./phoneNumber.cases.ts";
import { getPhoneValidationMessage, normalizePhoneToE164 } from "./phoneNumber.ts";

test("domestic, +381 and 00381 forms of one number normalize to the same E.164 value", () => {
  for (const [input, expected] of PHONE_CASES) {
    const result = normalizePhoneToE164(input);
    assert.deepEqual(result.ok ? result.e164 : null, expected, input);
  }
});

test("messages distinguish a missing from an invalid number and show the example", () => {
  assert.equal(getPhoneValidationMessage(""), "Unesite broj telefona.");
  assert.match(getPhoneValidationMessage("641234567") ?? "", /064 123 4567 ili \+381 64 123 4567/);
  assert.equal(getPhoneValidationMessage("+381 64 123 4567"), null);
});
