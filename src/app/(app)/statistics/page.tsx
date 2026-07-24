"use client";

import { Suspense } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

import { useAuthorization } from "@/context/AuthorizationContext";
import { AppointmentStatusChart } from "@/features/statistics/components/AppointmentStatusChart";
import { BookingSourceChart } from "@/features/statistics/components/BookingSourceChart";
import { ClientStatisticsSection } from "@/features/statistics/components/ClientStatisticsSection";
import { EmployeePerformanceTable } from "@/features/statistics/components/EmployeePerformanceTable";
import { StatisticsHeader } from "@/features/statistics/components/StatisticsHeader";
import { StatisticsOverviewCards } from "@/features/statistics/components/StatisticsOverviewCards";
import { StatisticsSkeleton } from "@/features/statistics/components/StatisticsSkeleton";
import { StatisticsTrendChart } from "@/features/statistics/components/StatisticsTrendChart";
import { TopServicesTable } from "@/features/statistics/components/TopServicesTable";
import { useStatistics } from "@/features/statistics/hooks/useStatistics";
import { FeatureGate } from "@/features/billing/components/FeatureGate";
import { LockedFeatureState } from "@/features/billing/components/LockedFeatureState";

import "./statistics.css";

const ERROR_MESSAGES = {
  UNAUTHORIZED: "Sesija nije dostupna. Prijavite se ponovo.",
  FORBIDDEN: "Nemate pristup statistici salona.",
  ENTITLEMENT_REQUIRED: "Statistika nije uključena u trenutni paket.",
  INVALID_PERIOD: "Izabrani period nije ispravan. Izaberite drugi period.",
  SALON_NOT_FOUND: "Salon nije pronađen.",
  STATISTICS_LOAD_FAILED: "Statistiku trenutno nije moguće učitati.",
} as const;

function StatisticsPageContent() {
  const { currentSalon } = useAuthorization();
  const statistics = useStatistics();

  if (!currentSalon) return null;

  return (
    <FeatureGate entitlement="canUseStatistics" fallback={
      <main className="statistics-page">
        <header className="statistics-header statistics-locked-header"><div className="statistics-header__title"><span>Pregled poslovanja</span><h1>Statistika</h1><p>{currentSalon.name}</p></div></header>
        <LockedFeatureState
          feature="statistics"
          title="Napredna statistika je dostupna u Pro paketu"
          description="Pratite prihod, učinak zaposlenih, najpopularnije usluge, klijente i trendove poslovanja."
          actionLabel="Pogledaj pakete"
          secondaryLabel="Nazad na dashboard"
          secondaryHref="/dashboard"
          preview={<><span /><span /><span /><span /><span /><span /></>}
        />
      </main>
    }>
    <main className="statistics-page">
      <StatisticsHeader
        salonName={currentSalon.name}
        data={statistics.data}
        period={statistics.period}
        loading={statistics.loading}
        onPreset={statistics.selectPreset}
        onCustom={statistics.updatePeriod}
      />

      {statistics.initialLoading && <StatisticsSkeleton />}

      {statistics.error && !statistics.data && (
        <section className="statistics-error" role="alert">
          <AlertTriangle size={24} />
          <div><h2>Statistika nije dostupna</h2><p>{ERROR_MESSAGES[statistics.error]}</p></div>
          {statistics.error !== "FORBIDDEN" && <button type="button" onClick={statistics.retry}><RefreshCw size={17} /> Pokušaj ponovo</button>}
        </section>
      )}

      {statistics.data && (
        <div className={`statistics-content ${statistics.loading ? "statistics-content--refreshing" : ""}`} aria-busy={statistics.loading}>
          {statistics.loading && <div className="statistics-refresh-indicator"><RefreshCw size={14} /> Osvežavam period…</div>}
          {statistics.error && <div className="statistics-inline-error" role="alert"><span>{ERROR_MESSAGES[statistics.error]}</span><button type="button" onClick={statistics.retry}>Pokušaj ponovo</button></div>}
          <StatisticsOverviewCards overview={statistics.data.overview} />
          <StatisticsTrendChart data={statistics.data} />
          <div className="statistics-breakdowns"><AppointmentStatusChart appointments={statistics.data.appointments} /><BookingSourceChart appointments={statistics.data.appointments} /></div>
          <div className="statistics-tables-grid"><TopServicesTable services={statistics.data.services} currency={statistics.data.overview.currency} /><ClientStatisticsSection data={statistics.data} /></div>
          <EmployeePerformanceTable employees={statistics.data.employees} currency={statistics.data.overview.currency} />
          <p className="statistics-timezone-note">Vreme i periodi prikazani su prema zoni <strong>{statistics.data.period.timezone}</strong>.</p>
        </div>
      )}
    </main>
    </FeatureGate>
  );
}

export default function StatisticsPage() {
  return <Suspense fallback={<main className="statistics-page"><StatisticsSkeleton /></main>}><StatisticsPageContent /></Suspense>;
}
