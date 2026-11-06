import test from "node:test";
import assert from "node:assert/strict";
import { getAppointmentMutationMessage } from "./appointmentMutationError.ts";
test("maps read-only without lifecycle leakage",()=>assert.match(getAppointmentMutationMessage({message:"APPOINTMENT_ACCESS_REQUIRED"}),/samo za pregled/));
test("maps stable errors",()=>assert.match(getAppointmentMutationMessage({code:"23P01"}),/slobodan/));
test("maps premature completion/no-show to the end-time message",()=>assert.match(getAppointmentMutationMessage({message:"APPOINTMENT_NOT_ENDED"}),/tek posle zakazanog kraja/));
