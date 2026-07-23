"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import { formatStatisticsNumber } from "../formatters";
import type { StatisticsResponse } from "../types";

const STATUS_CONFIG = [
  { key: "pending", label: "Na čekanju", color: "#d97706" },
  { key: "confirmed", label: "Potvrđeno", color: "#2563eb" },
  { key: "completed", label: "Završeno", color: "#16a34a" },
  { key: "cancelled", label: "Otkazano", color: "#dc2626" },
  { key: "no_show", label: "Nije došao", color: "#7c3aed" },
] as const;

export function AppointmentStatusChart({ appointments }: { appointments: StatisticsResponse["appointments"] }) {
  const values = STATUS_CONFIG.map((status) => ({ ...status, value: appointments.byStatus[status.key] }));
  return (
    <section className="statistics-card statistics-breakdown">
      <div className="statistics-card__header"><div><h2>Status termina</h2><p>{formatStatisticsNumber(appointments.total)} ukupno zakazanih termina.</p></div></div>
      {appointments.total === 0 ? <div className="statistics-empty">Nema termina u izabranom periodu.</div> : <div className="statistics-breakdown__body">
        <div className="statistics-donut" role="img" aria-label={values.map((item) => `${item.label}: ${item.value}`).join("; ")}>
          <ResponsiveContainer width="100%" height="100%"><PieChart accessibilityLayer><Pie isAnimationActive={false} data={values} dataKey="value" nameKey="label" innerRadius={54} outerRadius={78} paddingAngle={2}>{values.map((item) => <Cell key={item.key} fill={item.color} />)}</Pie><Tooltip wrapperStyle={{ maxWidth: "calc(100vw - 48px)", fontSize: 12 }} formatter={(value) => formatStatisticsNumber(Number(value))} /></PieChart></ResponsiveContainer>
          <strong>{formatStatisticsNumber(appointments.total)}</strong>
        </div>
        <ul>{values.map((item) => <li key={item.key}><i style={{ background: item.color }} /><span>{item.label}</span><strong>{formatStatisticsNumber(item.value)} · {(item.value / appointments.total * 100).toLocaleString("sr-RS", { maximumFractionDigits: 1 })}%</strong></li>)}</ul>
      </div>}
    </section>
  );
}
