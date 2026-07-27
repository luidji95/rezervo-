import assert from "node:assert/strict";
import test from "node:test";
import { BusinessDataMutationError, getBusinessDataMutationMessage, throwBusinessDataMutationError } from "./businessDataMutationError.ts";

test("maps read-only DB errors to the stable safe contract", () => {
  assert.throws(
    () => throwBusinessDataMutationError({ message: "SALON_WRITE_ACCESS_REQUIRED", code: "P0001" }),
    (error) => error instanceof BusinessDataMutationError && error.code === "SALON_WRITE_ACCESS_REQUIRED",
  );
  assert.match(getBusinessDataMutationMessage(new BusinessDataMutationError("SALON_WRITE_ACCESS_REQUIRED"), "fallback"), /samo za pregled/);
});

test("does not expose unknown PostgreSQL details", () => {
  assert.throws(
    () => throwBusinessDataMutationError({ message: "constraint clients_secret_detail", code: "23505" }),
    (error) => error instanceof BusinessDataMutationError && error.message === "INVALID_INPUT",
  );
});
