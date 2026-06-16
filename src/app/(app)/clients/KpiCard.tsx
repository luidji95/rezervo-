import type { ReactNode } from "react";

type KpiCardProps = {
  label: string;
  value: string;
  icon: ReactNode;
  muted?: string;
};

export function KpiCard({ label, value, icon, muted }: KpiCardProps) {
  return (
    <article className="client-kpi-card">
      <div className="client-kpi-icon">{icon}</div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        {muted && <small>{muted}</small>}
      </div>
    </article>
  );
}
