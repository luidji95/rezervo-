import { Check, Sparkles } from "lucide-react";
import { currentPlanPreview } from "../data/billingPreviewData";

export function CurrentPlanCard() {
  return (
    <section className="billing-current-card" aria-labelledby="current-plan-title">
      <div className="billing-current-topline">
        <span className="billing-icon-box"><Sparkles size={18} /></span>
        <span className="billing-badge billing-badge--inverse">UI preview</span>
      </div>
      <div>
        <p className="billing-eyebrow">Trenutni plan</p>
        <h2 id="current-plan-title">{currentPlanPreview.name}</h2>
        <div className="billing-current-price">
          <strong>{currentPlanPreview.price}</strong><span>/ mesec</span>
        </div>
        <p>{currentPlanPreview.description}</p>
      </div>
      <ul className="billing-feature-list billing-feature-list--inverse">
        {currentPlanPreview.features.map((feature) => (
          <li key={feature}><Check size={15} />{feature}</li>
        ))}
      </ul>
      <button type="button" className="billing-inverse-button" disabled title="Billing uskoro dostupan">
        Upravljanje planom
      </button>
      <small>Billing još nije aktiviran.</small>
    </section>
  );
}
