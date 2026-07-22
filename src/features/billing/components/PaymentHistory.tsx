import { Download, ReceiptText } from "lucide-react";
import { paymentHistoryPreview } from "../data/billingPreviewData";

export function PaymentHistory() {
  return <section className="billing-section billing-detail-card" aria-labelledby="payment-history-title">
    <div className="billing-section-header"><span className="billing-detail-icon"><ReceiptText size={18} /></span><div><p className="billing-eyebrow">Istorija plaćanja</p><h2 id="payment-history-title">Poslednje uplate</h2></div></div>
    <div className="billing-payment-list">{paymentHistoryPreview.map((payment) => <div className="billing-payment-row" key={payment.id}><div><strong>{payment.plan}</strong><span>{payment.date}</span></div><div className="billing-payment-meta"><strong>{payment.amount}</strong><span className="billing-success-badge">{payment.status}</span></div><button type="button" disabled aria-label={`Preuzmi demo račun za ${payment.date}`} title="Računi još nisu dostupni"><Download size={16} /></button></div>)}</div>
    <button type="button" className="billing-link-button" disabled title="Računi još nisu dostupni">Pogledaj sve račune</button>
  </section>;
}
