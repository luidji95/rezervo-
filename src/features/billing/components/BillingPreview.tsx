"use client";

import { CalendarClock, Check, CircleMinus, Clock3, Sparkles, Users } from "lucide-react";
import { useEntitlements } from "../hooks/useEntitlements";
import { useBillingUsage } from "../hooks/useBillingUsage";
import { PLAN_DESCRIPTIONS, PLAN_PRESENTATIONS, type PlanFeaturePresentation } from "../data/planPresentation";
import { getBillingAccessPresentation } from "../services/billingAccessPresentation";
import { formatPlanPrice, getTrialPlanPriceMessage } from "../services/planCatalog";
import type { SalonEntitlements } from "../types/entitlements";
import styles from "./BillingPreview.module.css";

const STATUS: Record<SalonEntitlements["subscriptionStatus"], { label: string; tone: string }> = {
  trialing: { label: "Probni period", tone: "trial" }, active: { label: "Aktivan", tone: "active" },
  past_due: { label: "Problem sa plaćanjem", tone: "warning" }, cancelled: { label: "Otkazano", tone: "neutral" }, expired: { label: "Isteklo", tone: "expired" },
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("sr-Latn-RS", { dateStyle: "long" }).format(new Date(value));
}

function remainingTrialDays(value: string) {
  return Math.max(0, Math.ceil((new Date(value).getTime() - Date.now()) / 86_400_000));
}

function FeatureRow({ feature, entitlements, current }: { feature: PlanFeaturePresentation; entitlements: SalonEntitlements; current: boolean }) {
  const availability = current && feature.entitlementKey ? (entitlements.planCapabilities[feature.entitlementKey] ? "included" : "not_included") : feature.availability;
  const comingSoon = availability === "coming_soon";
  const included = availability === "included";
  return <li><span className={included ? styles.included : comingSoon ? styles.soon : styles.excluded}>{included ? <Check size={15} /> : comingSoon ? <Clock3 size={15} /> : <CircleMinus size={15} />}</span><span>{feature.label}</span><small>{included ? "Uključeno" : comingSoon ? "Uskoro" : "Nije uključeno"}</small></li>;
}

export function BillingPreview() {
  const entitlementState = useEntitlements();
  const usageState = useBillingUsage();
  const entitlements = entitlementState.entitlements;

  if (entitlementState.loading) return <div className={styles.loading} aria-label="Učitavanje podataka o paketu" aria-busy="true"><span /><span /><span /></div>;
  if (entitlementState.error || !entitlements || !PLAN_PRESENTATIONS.some((plan) => plan.code === entitlements.planCode)) {
    return <section className={styles.fallback} role="status"><h2>Podaci o paketu trenutno nisu dostupni.</h2><p>Pokušajte ponovo. Ostala podešavanja salona ostaju dostupna.</p><button type="button" onClick={() => void entitlementState.refetchEntitlements()}>Pokušaj ponovo</button></section>;
  }

  const accessPresentation = getBillingAccessPresentation(entitlements);
  const status = accessPresentation.statusLabel
    ? { label: accessPresentation.statusLabel, tone: accessPresentation.statusTone! }
    : STATUS[entitlements.subscriptionStatus];
  const trialDays = entitlements.trialEndsAt ? remainingTrialDays(entitlements.trialEndsAt) : null;
  const planDescription = entitlements.planCode ? PLAN_DESCRIPTIONS[entitlements.planCode] : "";
  const currentCatalogPlan = usageState.plans?.find((plan) => plan.code === entitlements.planCode);

  return <div className={styles.page}>
    <section className={styles.overview} aria-labelledby="billing-current-title">
      <div className={styles.overviewMain}><div className={styles.eyebrow}><Sparkles size={16} /> Trenutna pretplata</div><div className={styles.titleRow}><h2 id="billing-current-title">{entitlements.planName}{entitlements.accessReason === "active_trial" ? " probni period" : ""}</h2><span className={`${styles.status} ${styles[status.tone]}`}>{status.label}</span></div><p>{planDescription}</p>
        {entitlements.accessReason === "active_trial" && entitlements.trialEndsAt && <div className={styles.dateNotice}><CalendarClock size={17} /><div><strong>Preostalo još {trialDays} {trialDays === 1 ? "dan" : "dana"}</strong><span>Probni period traje do {formatDate(entitlements.trialEndsAt)}.</span></div></div>}
        {entitlements.accessReason === "active_trial" && currentCatalogPlan && <p className={styles.periodDate}>{getTrialPlanPriceMessage(currentCatalogPlan)}</p>}
        {entitlements.isReadOnly && <p className={styles.periodDate}>Pristup funkcijama paketa je trenutno ograničen.</p>}
        {entitlements.isLegacyActive && <p className={styles.periodDate}>Aktivan pristup bez definisanog obračunskog perioda.</p>}
        {accessPresentation.paymentMessage && <p className={styles.periodDate}>{accessPresentation.paymentMessage}</p>}
        {accessPresentation.accessEndsAt && <p className={styles.periodDate}>Pristup važi do {formatDate(accessPresentation.accessEndsAt)}.</p>}
        {!entitlements.isBillingExempt && entitlements.currentPeriodEndsAt && <p className={styles.periodDate}>Trenutni period traje do {formatDate(entitlements.currentPeriodEndsAt)}.</p>}
      </div>
      <div className={styles.usage}><span className={styles.usageIcon}><Users size={20} /></span><span>Aktivni zaposleni</span>{usageState.loading ? <i className={styles.usageSkeleton} /> : usageState.error || !usageState.usage ? <strong>Podatak trenutno nije dostupan</strong> : <><strong>{usageState.usage.activeEmployees}{entitlements.planCapabilities.maxEmployees === null ? "" : ` / ${entitlements.planCapabilities.maxEmployees}`}</strong>{entitlements.planCapabilities.maxEmployees === null && <small>Bez ograničenja</small>}</>}</div>
    </section>

    <section className={styles.plans} aria-labelledby="billing-plans-title"><div className={styles.sectionHeading}><div><span>Poređenje paketa</span><h2 id="billing-plans-title">Paketi prilagođeni fazi vašeg salona</h2></div><p>Online plaćanje još nije uvedeno. Kartice ispod ne pokreću kupovinu.</p></div><div className={styles.planGrid}>{PLAN_PRESENTATIONS.map((plan) => {
      const current = plan.code === entitlements.planCode;
      const catalogPlan = usageState.plans?.find((item) => item.code === plan.code);
      const comingSoon = catalogPlan ? !catalogPlan.isAvailable : Boolean(plan.comingSoon);
      return <article key={plan.code} className={`${styles.planCard} ${current ? styles.current : ""}`}><div className={styles.planTop}><h3>{catalogPlan?.name ?? plan.name}</h3><div>{current && <span className={styles.currentBadge}>Trenutni paket</span>}{comingSoon && <span className={styles.soonBadge}>Uskoro</span>}</div></div>{catalogPlan && <div className={styles.planPrice}><strong>{formatPlanPrice(catalogPlan.monthlyPrice, catalogPlan.currency)}</strong><span>/mesečno</span>{catalogPlan.maxEmployees !== null && <small>Do {catalogPlan.maxEmployees} aktivnih zaposlenih</small>}</div>}<p>{plan.description}</p><ul>{plan.features.map((feature) => <FeatureRow key={feature.label} feature={feature} entitlements={entitlements} current={current} />)}</ul><button type="button" disabled>{current ? "Trenutni paket" : comingSoon ? "AI paket je u pripremi" : "Online nadogradnja uskoro"}</button></article>;
    })}</div></section>

    <section className={styles.paymentNotice}><Clock3 size={20} /><div><h2>Online upravljanje paketom je u pripremi</h2><p>Trenutni pristup i paket prikazani su iz stvarnih subscription podataka. Rezervo trenutno ne čuva karticu i ne prikazuje izmišljene naplate ili račune.</p></div></section>
  </div>;
}
