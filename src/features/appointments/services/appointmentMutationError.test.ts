import test from "node:test";
import assert from "node:assert/strict";
import { getAppointmentMutationMessage } from "./appointmentMutationError.ts";
test("maps read-only without lifecycle leakage",()=>assert.match(getAppointmentMutationMessage({message:"APPOINTMENT_ACCESS_REQUIRED"}),/samo za pregled/));
test("maps stable errors",()=>assert.match(getAppointmentMutationMessage({code:"23P01"}),/slobodan/));
