"use client";

import Link from "next/link";
import { getBillingPaymentPresentation } from "../services/billingPaymentPresentation";
import { CalendarClock, Check, CircleMinus, Clock3, Sparkles, Users } from "lucide-react";
import { useEntitlements } from "../hooks/useEntitlements";
import { useBillingUsage } from "../hooks/useBillingUsage";
import { useBillingCheckout } from "../hooks/useBillingCheckout";
import { useBillingCustomerPortal } from "../hooks/useBillingCustomerPortal";
import { useBillingStatusRefresh } from "../hooks/useBillingStatusRefresh";
import { useAuthorization } from "@/context/AuthorizationContext";
import { useAuth } from "@/context/AuthContext";
import { formatBillingDate, getSubscriptionStatusPresentation } from "../services/billingSubscriptionPresentation";
import { getRefreshMessage } from "../services/billingStatusRefresh";
import { getEffectiveEmployeeLimit, getPendingCheckoutNotice, getPurchaseActivationNotice } from "../services/billingCapacityPresentation";
import { PLAN_DESCRIPTIONS, PLAN_PRESENTATIONS, type PlanFeaturePresentation } from "../data/planPresentation";
import { getBillingAccessPresentation } from "../services/billingAccessPresentation";
import { getCheckoutButtonPresentation } from "../services/billingCheckoutPresentation";
import { remainingTrialDays } from "../services/billingPricingPresentation";
import { formatPlanPrice, getTrialPlanPriceMessage } from "../services/planCatalog";
import type { SalonEntitlements } from "../types/entitlements";
import styles from "./BillingPreview.module.css";

const CHECKOUT_ENABLED =
  process.env.NEXT_PUBLIC_BILLING_CHECKOUT_ENABLED === "true";

const STATUS: Record<SalonEntitlements["subscriptionStatus"], { label: string; tone: string }> = {
  trialing: { label: "Probni period", tone: "trial" }, active: { label: "Aktivan", tone: "active" },
  past_due: { label: "Problem sa plaćanjem", tone: "warning" }, cancelled: { label: "Otkazano", tone: "neutral" }, expired: { label: "Isteklo", tone: "expired" },
};

function formatDate(value: string) {
  return formatBillingDate(value) ?? "";
}

function FeatureRow({ feature, entitlements, current }: { feature: PlanFeaturePresentation; entitlements: SalonEntitlements; current: boolean }) {
  const availability = current && feature.entitlementKey ? (entitlements.planCapabilities[feature.entitlementKey] ? "included" : "not_included") : feature.availability;
  const comingSoon = availability === "coming_soon";
  const included = availability === "included";
  return <li><span aria-hidden className={included ? styles.included : comingSoon ? styles.soon : styles.excluded}>{included ? <Check size={15} /> : comingSoon ? <Clock3 size={15} /> : <CircleMinus size={15} />}</span><span>{feature.label}</span><small>{included ? "Uključeno" : comingSoon ? "Uskoro" : "Nije uključeno"}</small></li>;
}

export function BillingPreview() {
  const entitlementState = useEntitlements();
  const usageState = useBillingUsage();
  const checkout = useBillingCheckout();
  const customerPortal = useBillingCustomerPortal();
  const { user } = useAuth();
  const { currentSalon } = useAuthorization();
  const entitlements = entitlementState.entitlements;
  const statusRefresh = useBillingStatusRefresh({
    scope: user && currentSalon ? `${user.id}:${currentSalon.id}` : null,
    entitlements,
    overview: usageState.overview,
    refreshEntitlements: entitlementState.refreshEntitlements,
    refreshOverview: usageState.refresh,
  });

  if (entitlementState.loading) return <div className={styles.loading} aria-label="Učitavanje podataka o paketu" aria-busy="true"><span /><span /><span /></div>;
  if (entitlementState.error || !entitlements) {
    return <section className={styles.fallback} role="status"><h2>Podaci o paketu trenutno nisu dostupni.</h2><p>Pokušajte ponovo. Ostala podešavanja salona ostaju dostupna.</p><button type="button" onClick={() => void entitlementState.refetchEntitlements()}>Pokušaj ponovo</button></section>;
  }

  const paymentPresentation = getBillingPaymentPresentation(usageState.overview, CHECKOUT_ENABLED);
  const accessPresentation = getBillingAccessPresentation(entitlements);
  const subscriptionPresentation = getSubscriptionStatusPresentation(entitlements, usageState.overview);
  const portal = subscriptionPresentation.portal;
  const employeeLimit = getEffectiveEmployeeLimit(entitlements);
  const purchaseActivationNotice = getPurchaseActivationNotice(entitlements);
  const pendingCheckoutNotice = getPendingCheckoutNotice(entitlements);
  const status = accessPresentation.statusLabel
    ? { label: accessPresentation.statusLabel, tone: accessPresentation.statusTone! }
    : entitlements.isReadOnly ? { label: "Pristup samo za pregled", tone: "expired" } : STATUS[entitlements.subscriptionStatus];
  const trialDays = entitlements.trialEndsAt ? remainingTrialDays(entitlements.trialEndsAt) : null;
  const planDescription = entitlements.planCode ? PLAN_DESCRIPTIONS[entitlements.planCode] : "";
  const currentCatalogPlan = usageState.plans?.find((plan) => plan.code === entitlements.planCode);

  return <div className={styles.page}>
    <section className={styles.overview} aria-labelledby="billing-current-title">
      <div className={styles.overviewMain}><div className={styles.eyebrow}><Sparkles size={16} /> Trenutna pretplata</div><div className={styles.titleRow}><h2 id="billing-current-title">{entitlements.planCode ? entitlements.planName : "Bez aktivnog paketa"}{entitlements.accessReason === "active_trial" ? " probni period" : ""}</h2><span className={`${styles.status} ${styles[status.tone]}`}>{status.label}</span></div><p>{planDescription}</p>
        {entitlements.accessReason === "active_trial" && entitlements.trialEndsAt && <div className={styles.dateNotice}><CalendarClock size={17} /><div><strong>Preostalo još {trialDays} {trialDays === 1 ? "dan" : "dana"}</strong><span>Probni period traje do {formatDate(entitlements.trialEndsAt)}.</span></div></div>}
        {entitlements.accessReason === "active_trial" && currentCatalogPlan && <p className={styles.periodDate}>{getTrialPlanPriceMessage(currentCatalogPlan)}</p>}
        {entitlements.isReadOnly && <p className={styles.periodDate}>Nalog je trenutno u režimu pregleda. Svi podaci ostaju sačuvani.</p>}
        {entitlements.isLegacyActive && <p className={styles.periodDate}>Aktivan pristup bez definisanog obračunskog perioda.</p>}
        {accessPresentation.paymentMessage && <p className={styles.periodDate}>{accessPresentation.paymentMessage}</p>}
        {accessPresentation.accessEndsAt && <p className={styles.periodDate}>Pristup važi do {formatDate(accessPresentation.accessEndsAt)}.</p>}
        {subscriptionPresentation.lines.map((line) => <p key={line} className={styles.periodDate}>{line}</p>)}
        <div className={styles.statusCheck}><button type="button" className={styles.statusCheckButton} disabled={statusRefresh.checking} aria-busy={statusRefresh.checking} onClick={() => void statusRefresh.checkStatus()}>{statusRefresh.checking ? "Provera…" : "Proveri status"}</button>{statusRefresh.outcome && <p role={statusRefresh.outcome === "failed" ? "alert" : "status"}>{getRefreshMessage(statusRefresh.outcome)}</p>}</div>
      </div>
      <div className={styles.usage}><span className={styles.usageIcon}><Users size={20} /></span><span>Aktivni zaposleni</span>{usageState.loading ? <i className={styles.usageSkeleton} /> : usageState.error || !usageState.usage ? <strong>Podatak trenutno nije dostupan</strong> : <><strong>{usageState.usage.activeEmployees}{employeeLimit === null ? "" : ` / ${employeeLimit}`}</strong>{employeeLimit === null && <small>Bez ograničenja</small>}</>}</div>
    </section>

    {usageState.error && <section className={styles.fallback} role="alert"><p>Billing pregled nije učitan. Pokušajte ponovo.</p><button type="button" onClick={() => void usageState.refetch()}>Pokušaj ponovo</button></section>}
    {purchaseActivationNotice && <p className={styles.portalNote} role="status">{purchaseActivationNotice}</p>}
    {!purchaseActivationNotice && pendingCheckoutNotice && <p className={styles.portalNote} role="status">{pendingCheckoutNotice}</p>}
    {entitlements.isReadOnly && usageState.overview && !usageState.overview.canStartCheckout && !usageState.overview.canOpenCustomerPortal && <p role="status">Za proveru ili ponovno aktiviranje pretplate kontaktirajte podršku.</p>}
    {portal.kind === "note" && <p className={styles.portalNote} role="status">{portal.message}</p>}
    {portal.kind === "action" && <section className={styles.portalNotice} aria-labelledby="billing-portal-title"><div><h2 id="billing-portal-title">{portal.title}</h2><p>{portal.description}</p>{customerPortal.error && <p className={styles.checkoutError} role="alert">{customerPortal.error}</p>}</div><button type="button" className={styles.portalButton} disabled={customerPortal.loading} aria-busy={customerPortal.loading} onClick={() => void customerPortal.openPortal()}>{customerPortal.loading ? "Otvaranje portala…" : portal.cta}</button></section>}

    <section className={styles.plans} aria-labelledby="billing-plans-title"><div className={styles.sectionHeading}><div><span>Poređenje paketa</span><h2 id="billing-plans-title">Paketi prilagođeni fazi vašeg salona</h2></div><p>{paymentPresentation.summary}</p></div>{checkout.error && <p className={styles.checkoutError} role="alert">{checkout.error}</p>}<div className={styles.planGrid}>{PLAN_PRESENTATIONS.map((plan) => {
      const current = plan.code === entitlements.planCode;
      const catalogPlan = usageState.plans?.find((item) => item.code === plan.code);
      const comingSoon = catalogPlan ? !catalogPlan.isAvailable : Boolean(plan.comingSoon);
      const button = getCheckoutButtonPresentation({ planCode: plan.code, currentPlanCode: entitlements.planCode, accessReason: entitlements.accessReason, isBillingExempt: entitlements.isBillingExempt, checkoutEnabled: CHECKOUT_ENABLED, checkoutEligible: !usageState.loading && !usageState.error && usageState.overview?.canStartCheckout === true && !entitlements.purchaseActivation && catalogPlan?.isAvailable === true, loadingPlan: checkout.loadingPlan });
      return <article key={plan.code} className={`${styles.planCard} ${current ? styles.current : ""}`}><div className={styles.planTop}><h3>{catalogPlan?.name ?? plan.name}</h3><div>{current && <span className={styles.currentBadge}>Trenutni paket</span>}{comingSoon && <span className={styles.soonBadge}>Uskoro</span>}</div></div>{catalogPlan && <div className={styles.planPrice}><strong>{plan.code === "premium" ? "od " : ""}{formatPlanPrice(catalogPlan.monthlyPrice, catalogPlan.currency)}</strong><span>/mesečno</span>{catalogPlan.maxEmployees !== null && <small>Do {catalogPlan.maxEmployees} aktivnih zaposlenih</small>}</div>}<p>{plan.description}</p><ul>{plan.features.map((feature) => <FeatureRow key={feature.label} feature={feature} entitlements={entitlements} current={current} />)}</ul><button type="button" className={!button.disabled ? styles.checkoutButton : undefined} disabled={button.disabled} aria-busy={checkout.loadingPlan === plan.code} onClick={button.checkoutPlan ? () => void checkout.startCheckout(button.checkoutPlan as "starter" | "pro") : undefined}>{button.label}</button></article>;
    })}</div></section>

    <section className={styles.paymentNotice}><Clock3 size={20} /><div><h2>{paymentPresentation.title}</h2><p>{paymentPresentation.notice}</p><Link href="/pricing">Pogledajte javno poređenje paketa</Link></div></section>
  </div>;
}
