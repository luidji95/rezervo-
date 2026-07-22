import { CreditCard, LockKeyhole } from "lucide-react";

export function PaymentMethodCard() {
  return <section className="billing-section billing-detail-card" aria-labelledby="payment-method-title">
    <div className="billing-section-header"><span className="billing-detail-icon"><CreditCard size={18} /></span><div><p className="billing-eyebrow">Način plaćanja</p><h2 id="payment-method-title">Kartica</h2></div></div>
    <div className="billing-card-preview"><div><span>VISA</span><span className="billing-badge billing-badge--neutral">Demo</span></div><strong>•••• 4242</strong><small>Važi do 06/27</small></div>
    <div className="billing-action-row"><button type="button" disabled title="Plaćanja još nisu implementirana">Dodaj novu karticu</button><button type="button" disabled title="Plaćanja još nisu implementirana">Promeni karticu</button></div>
    <p className="billing-security-note"><LockKeyhole size={14} />Podaci o plaćanju nisu stvarno sačuvani. Ovo je samo UI preview.</p>
  </section>;
}
