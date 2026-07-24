"use client";
import Link from "next/link";
import { BarChart3, LockKeyhole } from "lucide-react";
import { UPGRADE_DESTINATION } from "../upgradeNavigation";
import styles from "./LockedFeatureState.module.css";

type Props = { title: string; description: string; feature: string; actionLabel?: string; actionHref?: string; secondaryLabel?: string; secondaryHref?: string; preview?: React.ReactNode };
export function LockedFeatureState({ title, description, feature, actionLabel = "Pogledaj pakete", actionHref = UPGRADE_DESTINATION, secondaryLabel, secondaryHref, preview }: Props) {
  const Icon = feature === "statistics" ? BarChart3 : LockKeyhole;
  return <section className={styles.shell} data-feature={feature} aria-labelledby={`locked-${feature}-title`}>
    {preview && <div className={styles.preview} aria-hidden="true">{preview}</div>}
    <div className={styles.card}><span className={styles.icon}><Icon size={25} aria-hidden="true" /></span><div className={styles.copy}><h2 id={`locked-${feature}-title`}>{title}</h2><p>{description}</p></div><div className={styles.actions}><Link className={styles.primary} href={actionHref}>{actionLabel}</Link>{secondaryLabel && secondaryHref && <Link className={styles.secondary} href={secondaryHref}>{secondaryLabel}</Link>}</div></div>
  </section>;
}
