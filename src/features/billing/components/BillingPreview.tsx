"use client";

import { useState } from "react";
import type { BillingPeriod } from "../types";
import { CurrentPlanCard } from "./CurrentPlanCard";
import { PaymentHistory } from "./PaymentHistory";
import { PaymentMethodCard } from "./PaymentMethodCard";
import { PricingPlans } from "./PricingPlans";
import { SubscriptionOverview } from "./SubscriptionOverview";

export function BillingPreview() {
  const [billingPeriod, setBillingPeriod] = useState<BillingPeriod>("monthly");
  return <div className="billing-page">
    <div className="billing-preview-notice"><strong>Billing preview</strong><span>Ovaj ekran prikazuje budući izgled. Naplata, kartice i pretplata nisu aktivni.</span></div>
    <div className="billing-top-grid"><CurrentPlanCard /><PricingPlans period={billingPeriod} onPeriodChange={setBillingPeriod} /></div>
    <div className="billing-details-grid"><PaymentMethodCard /><PaymentHistory /><SubscriptionOverview /></div>
  </div>;
}
