import { Check } from "lucide-react";
import { previewPlans } from "../data/billingPreviewData";
import type { BillingPeriod } from "../types";

type PricingPlansProps = {
  period: BillingPeriod;
  onPeriodChange: (period: BillingPeriod) => void;
};

export function PricingPlans({ period, onPeriodChange }: PricingPlansProps) {
  return (
    <section className="billing-section billing-pricing" aria-labelledby="pricing-title">
      <div className="billing-section-header billing-section-header--row">
        <div><p className="billing-eyebrow">Dostupni planovi</p><h2 id="pricing-title">Izaberite paket po meri salona</h2></div>
        <div className="billing-period-toggle" aria-label="Period obračuna">
          <button type="button" className={period === "monthly" ? "active" : ""} onClick={() => onPeriodChange("monthly")} aria-pressed={period === "monthly"}>Mesečno</button>
          <button type="button" className={period === "yearly" ? "active" : ""} onClick={() => onPeriodChange("yearly")} aria-pressed={period === "yearly"}>Godišnje <span>-20%</span></button>
        </div>
      </div>
      <div className="billing-plans-grid">
        {previewPlans.map((plan) => (
          <article key={plan.id} className={`billing-plan-card ${plan.popular ? "billing-plan-card--featured" : ""}`}>
            <div className="billing-plan-heading"><h3>{plan.name}</h3>{plan.popular && <span className="billing-badge">Najpopularniji</span>}</div>
            <p>{plan.description}</p>
            <div className="billing-plan-price"><strong>{period === "monthly" ? plan.monthlyPrice : plan.yearlyPrice}</strong><span>/{period === "monthly" ? "mesec" : "godina"}</span></div>
            <ul className="billing-feature-list">
              {plan.features.map((feature) => <li key={feature}><Check size={15} />{feature}</li>)}
            </ul>
            <button type="button" className={plan.current ? "billing-plan-button billing-plan-button--current" : "billing-plan-button"} disabled title="Promena plana još nije dostupna">
              {plan.current ? "Trenutni demo plan" : `Izaberi ${plan.name}`}
            </button>
          </article>
        ))}
      </div>
      <p className="billing-helper">Cene i planovi su ilustrativni. Promena plana još nije dostupna.</p>
    </section>
  );
}
