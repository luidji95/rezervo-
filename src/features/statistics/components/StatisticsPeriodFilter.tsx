"use client";

import { useEffect, useState } from "react";

import { statisticsPeriodInputSchema } from "../schemas/statisticsSchema";
import type { StatisticsPeriodInput, StatisticsPreset } from "../types";

const OPTIONS: Array<{ value: StatisticsPreset; label: string }> = [
  { value: "today", label: "Danas" },
  { value: "last_7_days", label: "Poslednjih 7 dana" },
  { value: "this_month", label: "Ovaj mesec" },
  { value: "previous_month", label: "Prethodni mesec" },
  { value: "last_3_months", label: "Poslednja 3 meseca" },
  { value: "this_year", label: "Ova godina" },
  { value: "custom", label: "Prilagođeni period" },
];

type Props = {
  value: StatisticsPeriodInput;
  disabled: boolean;
  onPreset: (preset: Exclude<StatisticsPreset, "custom">) => void;
  onCustom: (period: StatisticsPeriodInput) => boolean;
};

export function StatisticsPeriodFilter({ value, disabled, onPreset, onCustom }: Props) {
  const [selectedPreset, setSelectedPreset] = useState<StatisticsPreset>(value.preset);
  const [customStart, setCustomStart] = useState(value.customStart ?? "");
  const [customEnd, setCustomEnd] = useState(value.customEnd ?? "");
  const [error, setError] = useState("");

  useEffect(() => {
    const request = window.setTimeout(() => {
      setSelectedPreset(value.preset);
      if (value.preset !== "custom") return;
      setCustomStart(value.customStart ?? "");
      setCustomEnd(value.customEnd ?? "");
    }, 0);
    return () => window.clearTimeout(request);
  }, [value]);

  const changePreset = (preset: StatisticsPreset) => {
    setError("");
    setSelectedPreset(preset);
    if (preset === "custom") {
      return;
    }
    onPreset(preset);
  };

  const applyCustom = () => {
    const candidate = { preset: "custom" as const, customStart, customEnd };
    const parsed = statisticsPeriodInputSchema.safeParse(candidate);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Izabrani period nije ispravan.");
      return;
    }
    const days = Math.floor(
      (new Date(`${customEnd}T00:00:00Z`).getTime() -
        new Date(`${customStart}T00:00:00Z`).getTime()) /
        86_400_000,
    ) + 1;
    if (days > 1096) {
      setError("Prilagođeni period može trajati najviše 3 godine.");
      return;
    }
    setError("");
    onCustom(parsed.data);
  };

  return (
    <div className="statistics-period-filter">
      <label>
        <span>Period</span>
        <select
          value={selectedPreset}
          disabled={disabled}
          onChange={(event) => changePreset(event.target.value as StatisticsPreset)}
        >
          {OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
      {selectedPreset === "custom" && (
        <div className="statistics-period-filter__custom">
          <label><span>Od</span><input type="date" value={customStart} disabled={disabled} onChange={(event) => setCustomStart(event.target.value)} /></label>
          <label><span>Do</span><input type="date" min={customStart} value={customEnd} disabled={disabled} onChange={(event) => setCustomEnd(event.target.value)} /></label>
          <button type="button" disabled={disabled} onClick={applyCustom}>Primeni</button>
        </div>
      )}
      {error && <p className="statistics-period-filter__error" role="alert">{error}</p>}
    </div>
  );
}
