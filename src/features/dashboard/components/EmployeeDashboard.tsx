"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CalendarDays, CalendarPlus, Clock3, ListChecks } from "lucide-react";

import EmployeeCreateAppointmentModal from "@/app/(app)/calendar/EmployeeCreateAppointmentModal";
import {
  DEFAULT_SALON_TIME_ZONE,
  getHourInTimeZone,
  getTodayDateKey,
} from "@/lib/salonDateTime";
import {
  getEmployeeNextAppointment,
  getEmployeeTodayAppointments,
  getEmployeeTodayWorkingSchedule,
  getEmployeeWeekKpis,
  type EmployeeDashboardAppointment,
  type EmployeeTodayWorkingSchedule,
  type EmployeeWeekKpis,
} from "@/features/dashboard/services/employeeDashboardService";
import type { CurrentSalon } from "@/services/salonService";
import type { Employee } from "@/types/employee";

type Props = { employee: Employee; salon: NonNullable<CurrentSalon> };
type SectionState<T> = { data: T; loading: boolean; error: string | null };

const EMPTY_KPIS: EmployeeWeekKpis = { completed: 0, confirmed: 0, noShow: 0, total: 0 };

function formatTime(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("sr-RS", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(new Date(value));
}

function statusLabel(status: string) {
  return {
    pending: "Na čekanju",
    confirmed: "Potvrđeno",
    completed: "Završeno",
    no_show: "Nije došao",
  }[status] ?? status;
}

function durationMinutes(appointment: EmployeeDashboardAppointment) {
  if (appointment.service?.durationMinutes) {
    return appointment.service.durationMinutes;
  }
  return Math.max(
    0,
    Math.round(
      (new Date(appointment.endTime).getTime() -
        new Date(appointment.startTime).getTime()) /
        60000,
    ),
  );
}

export function EmployeeDashboard({ employee, salon }: Props) {
  const timeZone = salon.timezone || DEFAULT_SALON_TIME_ZONE;
  const todayKey = getTodayDateKey(timeZone);
  const [createOpen, setCreateOpen] = useState(false);
  const [today, setToday] = useState<SectionState<EmployeeDashboardAppointment[]>>({
    data: [], loading: true, error: null,
  });
  const [next, setNext] = useState<SectionState<EmployeeDashboardAppointment | null>>({
    data: null, loading: true, error: null,
  });
  const [kpis, setKpis] = useState<SectionState<EmployeeWeekKpis>>({
    data: EMPTY_KPIS, loading: true, error: null,
  });
  const [schedule, setSchedule] = useState<SectionState<EmployeeTodayWorkingSchedule | null>>({
    data: null, loading: true, error: null,
  });

  const loadDashboard = useCallback(async () => {
    setToday((state) => ({ ...state, loading: true, error: null }));
    setNext((state) => ({ ...state, loading: true, error: null }));
    setKpis((state) => ({ ...state, loading: true, error: null }));
    setSchedule((state) => ({ ...state, loading: true, error: null }));

    const common = {
      salonId: salon.id,
      employeeId: employee.id,
      dateKey: todayKey,
      timeZone,
    };
    const [todayResult, nextResult, kpiResult, scheduleResult] =
      await Promise.allSettled([
        getEmployeeTodayAppointments(common),
        getEmployeeNextAppointment(common),
        getEmployeeWeekKpis(common),
        getEmployeeTodayWorkingSchedule(common),
      ]);

    setToday(
      todayResult.status === "fulfilled"
        ? { data: todayResult.value, loading: false, error: null }
        : { data: [], loading: false, error: "Današnji termini trenutno nisu dostupni." },
    );
    setNext(
      nextResult.status === "fulfilled"
        ? { data: nextResult.value, loading: false, error: null }
        : { data: null, loading: false, error: "Sledeći termin trenutno nije dostupan." },
    );
    setKpis(
      kpiResult.status === "fulfilled"
        ? { data: kpiResult.value, loading: false, error: null }
        : { data: EMPTY_KPIS, loading: false, error: "Nedeljni podaci trenutno nisu dostupni." },
    );
    setSchedule(
      scheduleResult.status === "fulfilled"
        ? { data: scheduleResult.value, loading: false, error: null }
        : { data: null, loading: false, error: "Radno vreme trenutno nije dostupno." },
    );
  }, [employee.id, salon.id, timeZone, todayKey]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void loadDashboard(), 0);
    const refresh = () => void loadDashboard();
    window.addEventListener("focus", refresh);
    window.addEventListener("rezervo:appointment-status-changed", refresh);
    return () => {
      window.clearTimeout(initialLoad);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("rezervo:appointment-status-changed", refresh);
    };
  }, [loadDashboard]);

  const employeeName = employee.display_name || employee.full_name;
  const currentHour = getHourInTimeZone(new Date(), timeZone);
  const greeting = currentHour < 12 ? "Dobro jutro" : currentHour < 18 ? "Dobar dan" : "Dobro veče";
  const todayLabel = new Intl.DateTimeFormat("sr-RS", {
    weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone,
  }).format(new Date());

  return (
    <main className="dashboard-page employee-dashboard">
      <header className="employee-dashboard__hero">
        <div>
          <p className="dashboard-kpi-label">{salon.name} · {todayLabel}</p>
          <h1>{greeting}, {employeeName}</h1>
          <p>Vaš operativni pregled termina i rasporeda.</p>
        </div>
        <button type="button" className="employee-dashboard__primary-action" onClick={() => setCreateOpen(true)}>
          <CalendarPlus size={18} /> Novi termin
        </button>
      </header>

      <section className="employee-dashboard__kpis" aria-label="Nedeljni pregled">
        {[
          { label: "Termini danas", value: today.data.length, loading: today.loading },
          { label: "Završeni ove nedelje", value: kpis.data.completed, loading: kpis.loading },
          { label: "Potvrđeni ove nedelje", value: kpis.data.confirmed, loading: kpis.loading },
          { label: "No-show ove nedelje", value: kpis.data.noShow, loading: kpis.loading },
        ].map(({ label, value, loading }) => (
          <article className="dashboard-card dashboard-kpi-card" key={String(label)}>
            <span className="dashboard-kpi-label">{label}</span>
            <strong className="dashboard-kpi-value">{loading ? "—" : value}</strong>
            <small className="dashboard-kpi-meta">Samo vaši termini</small>
          </article>
        ))}
      </section>
      {kpis.error && <p className="employee-dashboard__section-error">{kpis.error}</p>}
      {!kpis.loading && !kpis.error && kpis.data.total === 0 && (
        <p className="employee-dashboard__empty employee-dashboard__weekly-empty">
          Nema podataka za ovu nedelju.
        </p>
      )}

      <section className="employee-dashboard__grid">
        <article className="dashboard-card employee-dashboard__appointments">
          <div className="dashboard-card-header">
            <div><h2>Moji termini danas</h2><p>{todayLabel}</p></div>
            <Link href="/calendar">Otvori kalendar</Link>
          </div>
          {today.loading ? <p>Učitavanje termina...</p> : today.error ? (
            <p className="employee-dashboard__section-error">{today.error}</p>
          ) : today.data.length === 0 ? <p className="employee-dashboard__empty">Danas nemate zakazane termine.</p> : (
            <ul className="employee-dashboard__appointment-list">
              {today.data.map((appointment) => (
                <li key={appointment.id}>
                  <time>{formatTime(appointment.startTime, timeZone)}</time>
                  <div><strong>{appointment.client?.fullName ?? "Klijent nije dostupan"}</strong><span>{appointment.service?.name ?? "Usluga nije dostupna"} · {durationMinutes(appointment)} min</span><small>{appointment.client?.phone || appointment.client?.email || "Kontakt nije dostupan"}</small></div>
                  <span className={`employee-dashboard__status employee-dashboard__status--${appointment.status}`}>{statusLabel(appointment.status)}</span>
                </li>
              ))}
            </ul>
          )}
        </article>

        <aside className="employee-dashboard__side">
          <article className="dashboard-card">
            <div className="dashboard-card-header"><div><h2>Sledeći termin</h2><p>Prvi naredni potvrđen ili na čekanju</p></div></div>
            {next.loading ? <p>Učitavanje...</p> : next.error ? <p className="employee-dashboard__section-error">{next.error}</p> : next.data ? (
              <div className="employee-dashboard__next"><strong>{formatTime(next.data.startTime, timeZone)}</strong><span>{next.data.client?.fullName ?? "Klijent nije dostupan"}</span><small>{next.data.service?.name ?? "Usluga nije dostupna"}</small></div>
            ) : <p className="employee-dashboard__empty">Nema narednih termina.</p>}
          </article>

          <article className="dashboard-card">
            <div className="dashboard-card-header"><div><h2>Moje radno vreme</h2><p>Današnji raspored</p></div></div>
            {schedule.loading ? <p>Učitavanje...</p> : schedule.error ? <p className="employee-dashboard__section-error">{schedule.error}</p> : !schedule.data?.isWorkingDay ? (
              <p className="employee-dashboard__empty">Danas niste u rasporedu.</p>
            ) : (
              <div className="employee-dashboard__schedule"><strong><Clock3 size={18} /> {schedule.data.opensAt?.slice(0, 5)}–{schedule.data.closesAt?.slice(0, 5)}</strong>{schedule.data.breakStartsAt && schedule.data.breakEndsAt && <span>Pauza {schedule.data.breakStartsAt.slice(0, 5)}–{schedule.data.breakEndsAt.slice(0, 5)}</span>}{schedule.data.usesSalonDefault && <small>Koristi se podrazumevani raspored salona.</small>}{schedule.data.closures.length > 0 && <p className="employee-dashboard__closure">{schedule.data.closures.map((closure) => closure.title).join(", ")}</p>}</div>
            )}
          </article>
        </aside>
      </section>

      <section className="dashboard-card employee-dashboard__quick-actions">
        <h2>Brze akcije</h2>
        <div><button type="button" onClick={() => setCreateOpen(true)}><CalendarPlus size={18} /> Novi termin</button><Link href="/calendar"><CalendarDays size={18} /> Otvori kalendar</Link><Link href="/appointmets"><ListChecks size={18} /> Svi moji termini</Link></div>
      </section>

      {createOpen && <EmployeeCreateAppointmentModal isOpen onClose={() => setCreateOpen(false)} selectedDate={todayKey} salonTimeZone={timeZone} onCreated={loadDashboard} />}
    </main>
  );
}
