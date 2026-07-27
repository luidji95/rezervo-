"use client";

import Link from "next/link";
import { Check, Clock3, Minus } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useAuthorization } from "@/context/AuthorizationContext";
import { useEntitlements } from "@/features/billing/hooks/useEntitlements";
import { formatPlanPrice } from "@/features/billing/services/planCatalog";
import { PLAN_PRESENTATIONS } from "@/features/billing/data/planPresentation";
import { getPricingCtaHref } from "../services/acquisitionRouting";
import type { PublicPlan } from "../types";
import styles from "./PricingCards.module.css";

export function PricingCards({ plans, compact = false }: { plans: PublicPlan[]; compact?: boolean }) {
  const { user } = useAuth();
  const { resolution } = useAuthorization();
  const { entitlements } = useEntitlements();
  const salonState = resolution === "loading" ? "loading" : resolution === "loaded_without_salon" ? "missing" : resolution === "loaded_with_incomplete_onboarding" ? "incomplete" : "complete";

  return <div className={`${styles.wrapper} ${compact ? styles.compact : ""}`}>
    <p className={styles.trialNotice}>Svi novi saloni dobijaju 14 dana Pro funkcija bez kartice. Paket birate nakon probnog perioda.</p>
    <div className={styles.grid}>{plans.map((plan) => {
      const presentation = PLAN_PRESENTATIONS.find((item) => item.code === plan.code)!;
      const premium = plan.code === "premium";
      const href = getPricingCtaHref({ authenticated: Boolean(user), salonState, plan: plan.code, readOnly: entitlements?.isReadOnly });
      return <article key={plan.code} className={`${styles.card} ${plan.code === "pro" ? styles.recommended : ""}`}>
        <div className={styles.top}><h3>{plan.name}</h3>{plan.code === "pro" && <span>Preporučeno</span>}{premium && <span>Uskoro</span>}</div>
        <div className={styles.price}><strong>{premium ? "od " : ""}{formatPlanPrice(plan.monthlyPrice, plan.currency)}</strong><small>/ mesečno</small></div>
        <p>{presentation.description}</p>
        <strong className={styles.limit}>Do {plan.maxEmployees} aktivnih zaposlenih</strong>
        <ul>{presentation.features.slice(0, compact ? 4 : undefined).map((feature) => {
          const planned = feature.availability === "coming_soon" || (premium && feature.label.toLowerCase().match(/ai|whatsapp|instagram|automat/));
          const included = feature.availability === "included" && !planned;
          return <li key={feature.label}>{planned ? <Clock3 aria-hidden /> : included ? <Check aria-hidden /> : <Minus aria-hidden />}<span>{feature.label}{planned ? " — U pripremi" : included ? " — Uključeno" : " — Nije uključeno"}</span></li>;
        })}</ul>
        {href ? <Link className={styles.cta} href={href}>{plan.code === "pro" ? "Probaj Pro 14 dana" : "Započni besplatno"}</Link> : <button className={styles.cta} type="button" disabled aria-describedby={`premium-note-${compact ? "compact" : "full"}`}>Uskoro</button>}
        <small id={premium ? `premium-note-${compact ? "compact" : "full"}` : undefined} className={styles.note}>{premium ? "Premium još nije javno dostupan. AI, WhatsApp, Instagram i marketing funkcije su planirane." : plan.code === "pro" ? "Kartica nije potrebna." : "Novi salon prvo dobija 14 dana Pro funkcija."}</small>
      </article>;
    })}</div>
  </div>;
}
