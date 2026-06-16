import type { ReactNode } from "react";

type KpiCardProps = {
  label: string;
  value: string;
  icon: ReactNode;
  muted?: string;
};

export function KpiCard({ label, value, icon, muted }: KpiCardProps) {
  return (
    <div className="employee-kpi-card">
      <div className="employee-kpi-icon">{icon}</div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        {muted && <small>{muted}</small>}
      </div>
    </div>
  );
}
