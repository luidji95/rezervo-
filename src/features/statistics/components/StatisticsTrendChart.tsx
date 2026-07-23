"use client";

import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { formatStatisticsBucket, formatStatisticsCurrency, formatStatisticsNumber } from "../formatters";
import type { StatisticsResponse } from "../types";

export function StatisticsTrendChart({ data }: { data: StatisticsResponse }) {
  const chartData = data.trend.map((item) => ({ ...item, label: formatStatisticsBucket(item.bucket, data.period.granularity) }));
  return (
    <section className="statistics-card statistics-trend">
      <div className="statistics-card__header"><div><h2>Trend poslovanja</h2><p>Promet i završeni termini po {data.period.granularity === "day" ? "danu" : "mesecu"}.</p></div></div>
      {chartData.length === 0 ? <div className="statistics-empty">Još nema dovoljno podataka za izabrani period.</div> : (
        <div className="statistics-chart" role="img" aria-label={`Trend: ${chartData.map((item) => `${item.label}, ${item.completedAppointments} termina, ${item.revenue} ${data.overview.currency}`).join("; ")}`}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 8, right: 4, left: -8, bottom: 4 }} accessibilityLayer>
              <CartesianGrid stroke="#eef0f4" vertical={false} />
              <XAxis dataKey="label" interval="preserveStartEnd" minTickGap={24} tick={{ fontSize: 10, fill: "#667085" }} tickLine={false} axisLine={false} />
              <YAxis yAxisId="revenue" tickFormatter={(value) => formatStatisticsNumber(Number(value))} tick={{ fontSize: 10, fill: "#667085" }} tickLine={false} axisLine={false} width={48} />
              <YAxis yAxisId="count" orientation="right" allowDecimals={false} tick={{ fontSize: 10, fill: "#667085" }} tickLine={false} axisLine={false} width={26} />
              <Tooltip wrapperStyle={{ maxWidth: "calc(100vw - 48px)", fontSize: 12 }} formatter={(value, name) => name === "Promet" ? formatStatisticsCurrency(Number(value), data.overview.currency) : formatStatisticsNumber(Number(value))} />
              <Legend wrapperStyle={{ paddingTop: 10, fontSize: 12 }} />
              <Bar isAnimationActive={false} yAxisId="revenue" dataKey="revenue" name="Promet" fill="#8b5cf6" radius={[6, 6, 0, 0]} maxBarSize={46} />
              <Line isAnimationActive={false} yAxisId="count" dataKey="completedAppointments" name="Završeni termini" stroke="#0f766e" strokeWidth={3} dot={{ r: 3 }} activeDot={{ r: 5 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
