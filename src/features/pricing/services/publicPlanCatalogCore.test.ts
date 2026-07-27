import assert from "node:assert/strict";
import test from "node:test";
import { normalizePublicPlanCatalog } from "./publicPlanCatalogCore.ts";
import { formatPlanPrice } from "../../billing/services/planCatalog.ts";

const rows = [
  { slug:"starter",name:"Starter",monthly_price:"2990",yearly_price:null,currency:"RSD",max_employees:3,is_active:true,analytics_enabled:false,sms_reminders_enabled:false,ai_receptionist_enabled:false,whatsapp_enabled:false,instagram_enabled:false,marketing_enabled:false,internal_note:"hidden" },
  { slug:"pro",name:"Pro",monthly_price:5990,yearly_price:null,currency:"RSD",max_employees:10,is_active:true,analytics_enabled:true,sms_reminders_enabled:true,ai_receptionist_enabled:false,whatsapp_enabled:false,instagram_enabled:false,marketing_enabled:false },
  { slug:"premium",name:"Premium",monthly_price:"17990",yearly_price:null,currency:"RSD",max_employees:25,is_active:false,analytics_enabled:true,sms_reminders_enabled:true,ai_receptionist_enabled:true,whatsapp_enabled:true,instagram_enabled:true,marketing_enabled:true },
];

test("normalizes the canonical public RSD catalogue without internal fields", () => {
  const plans = normalizePublicPlanCatalog(rows);
  assert.deepEqual(plans.map((p) => [p.code,p.monthlyPrice,p.yearlyPrice,p.maxEmployees,p.isAvailable]), [
    ["starter",2990,null,3,true],["pro",5990,null,10,true],["premium",17990,null,25,false],
  ]);
  assert.equal(plans[0].capabilities.analytics,false);
  assert.equal(plans[1].capabilities.analytics,true);
  assert.equal(plans[1].capabilities.smsReminders,true);
  assert.deepEqual(plans[2].capabilities, { analytics:true, smsReminders:true, aiReceptionist:true, whatsapp:true, instagram:true, marketing:true });
  assert.deepEqual(plans.map((plan) => formatPlanPrice(plan.monthlyPrice, plan.currency)), ["2.990 RSD", "5.990 RSD", "17.990 RSD"]);
  assert.equal("internal_note" in plans[0],false);
});

test("missing or invalid plans fail closed instead of inventing a price", () => {
  assert.throws(() => normalizePublicPlanCatalog(rows.slice(0,2)), /INCOMPLETE/);
  assert.throws(() => normalizePublicPlanCatalog([{...rows[0],monthly_price:"invalid"},rows[1],rows[2]]), /INCOMPLETE/);
  assert.throws(() => normalizePublicPlanCatalog([{...rows[0],currency:"EUR"},rows[1],rows[2]]), /INCOMPLETE/);
  assert.throws(() => normalizePublicPlanCatalog([{...rows[0],yearly_price:29900},rows[1],rows[2]]), /INCOMPLETE/);
  assert.throws(() => normalizePublicPlanCatalog([{...rows[0],max_employees:4},rows[1],rows[2]]), /INCOMPLETE/);
  assert.throws(() => normalizePublicPlanCatalog([rows[0],rows[0],rows[1],rows[2]]), /INCOMPLETE/);
});
