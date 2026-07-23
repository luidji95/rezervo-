import { BarChart3, Info } from "lucide-react";

import type { StatisticsPeriodInput, StatisticsResponse } from "../types";
import { formatStatisticsDate } from "../formatters";
import { StatisticsPeriodFilter } from "./StatisticsPeriodFilter";

type Props = {
  salonName: string;
  data: StatisticsResponse | null;
  period: StatisticsPeriodInput;
  loading: boolean;
  onPreset: Parameters<typeof StatisticsPeriodFilter>[0]["onPreset"];
  onCustom: Parameters<typeof StatisticsPeriodFilter>[0]["onCustom"];
};

export function StatisticsHeader({ salonName, data, period, loading, onPreset, onCustom }: Props) {
  return (
    <header className="statistics-header">
      <div className="statistics-header__title">
        <span><BarChart3 size={16} /> Poslovni pregled</span>
        <h1>Statistika</h1>
        <p>Pregled poslovanja salona {salonName} za izabrani period.</p>
        {data && <small>{formatStatisticsDate(data.period.startDate)} – {formatStatisticsDate(data.period.endDate)} · {data.period.timezone}</small>}
      </div>
      <StatisticsPeriodFilter value={period} disabled={loading} onPreset={onPreset} onCustom={onCustom} />
      <div className="statistics-header__notice"><Info size={17} /><span>Promet prikazuje vrednost završenih termina, bez obzira na status naplate.</span></div>
    </header>
  );
}
