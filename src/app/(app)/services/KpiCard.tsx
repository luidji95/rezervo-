import type { ReactNode } from "react";

type KpiCardProps = {
  label: string;
  value: string;
  icon: ReactNode;
  muted?: string;
};

export function KpiCard({ label, value, icon, muted }: KpiCardProps) {
  return (
    <div className="service-kpi-card">
      <div className="service-kpi-icon">{icon}</div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        {muted && <small>{muted}</small>}
      </div>
    </div>
  );
}
