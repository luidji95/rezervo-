import styles from "./UsageLimitIndicator.module.css";
export function UsageLimitIndicator({ current, limit, unit, planName }: { current: number; limit: number | null; unit: string; planName?: string }) {
  const reached = limit !== null && current >= limit;
  const near = limit !== null && !reached && current >= Math.max(1, Math.ceil(limit * .8));
  return <span className={`${styles.indicator} ${reached ? styles.reached : near ? styles.near : ""}`}><strong>{limit === null ? `${current} ${unit}` : `${current} od ${limit} ${unit}`}</strong>{planName && <span> · {planName} paket</span>}</span>;
}
