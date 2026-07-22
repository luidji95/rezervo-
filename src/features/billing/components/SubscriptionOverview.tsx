import { CalendarClock } from "lucide-react";

const subscriptionRows = [["Status", "Demo"], ["Plan", "Pro Plan"], ["Cena", "2.990 RSD / mesec"], ["Sledeće naplaćivanje", "Nije aktivirano"], ["Način plaćanja", "Nije povezan"]] as const;

export function SubscriptionOverview() {
  return <section className="billing-section billing-detail-card" aria-labelledby="subscription-title">
    <div className="billing-section-header"><span className="billing-detail-icon"><CalendarClock size={18} /></span><div><p className="billing-eyebrow">Pregled pretplate</p><h2 id="subscription-title">Detalji plana</h2></div></div>
    <dl className="billing-subscription-list">{subscriptionRows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    <button type="button" className="billing-danger-button" disabled title="Pretplata nije aktivna">Otkaži pretplatu</button>
    <p className="billing-helper">Billing još nije aktivan. Ova sekcija je samo pregled budućeg izgleda.</p>
  </section>;
}
