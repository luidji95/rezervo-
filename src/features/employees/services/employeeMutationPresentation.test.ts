import assert from "node:assert/strict";
import test from "node:test";
import { getEmployeeMutationMessage } from "./employeeMutationPresentation.ts";

for (const [code, expected] of [
  ["EMPLOYEE_LIMIT_REACHED", "Dostigli ste maksimalan broj zaposlenih za trenutni paket."],
  ["EMPLOYEE_ACCESS_REQUIRED", "Pretplata trenutno ne dozvoljava aktiviranje zaposlenih."],
  ["FORBIDDEN", "Nemate ovlašćenje za izmenu ovog zaposlenog."],
  ["EMPLOYEE_NOT_FOUND", "Zaposleni nije pronađen."],
] as const) {
  test(`maps ${code} to safe employee UI copy`, () => {
    const error = new Error("internal details must not be shown");
    error.name = code;
    assert.equal(getEmployeeMutationMessage(error, "fallback"), expected);
  });
}

test("unknown errors use a controlled fallback", () => {
  assert.equal(getEmployeeMutationMessage(new Error("SQL detail"), "Kontrolisana greška."), "Kontrolisana greška.");
});
