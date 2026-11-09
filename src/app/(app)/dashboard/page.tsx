"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";

import { useSalon } from "@/context/SalonContext";
import { useAuthorization } from "@/context/AuthorizationContext";
import { EmployeeDashboard } from "@/features/dashboard/components/EmployeeDashboard";
import { loadOwnerDashboardSections, type DashboardSectionName } from "@/features/dashboard/services/ownerDashboardLoader";
import {
  applyDashboardSectionResult,
  formatAppointmentStatus,
  initialDashboardSection,
  type DashboardSection,
  type TodayOccupancy,
} from "@/features/dashboard/services/dashboardMetricsCore";
import { getDashboardStats, getTodayOccupancy, type DashboardStats } from "@/services/dashboardStatsService";
import { getTodaySchedule, getUpcomingAppointments } from "@/services/dashboardAppointmentsService";
import { getPopularServices, getTopClients, type PopularService, type TopClient } from "@/services/dashboardAnalyticsService";
import { getCalendarEmployees, type CalendarEmployee } from "@/services/employeeQueryService";
import type { AppointmentListItem } from "@/services/appointmentQueryService";
import {
  DEFAULT_SALON_TIME_ZONE,
  getHourInTimeZone,
  getTodayDateKey,
} from "@/lib/salonDateTime";

import "../calendar/calendar.css";
import "./dashboard.css";

const DEFAULT_DASHBOARD_HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17];
const MAX_MINI_CALENDAR_COLUMNS = 4;

type EmployeeColumn = {
  id: string;
  name: string;
};

type OwnerSections = {
  stats: DashboardSection<DashboardStats>;
  occupancy: DashboardSection<TodayOccupancy>;
  todaySchedule: DashboardSection<AppointmentListItem[]>;
  upcomingAppointments: DashboardSection<AppointmentListItem[]>;
  employees: DashboardSection<CalendarEmployee[]>;
  popularServices: DashboardSection<PopularService[]>;
  topClients: DashboardSection<TopClient[]>;
};

const initialSections = (): OwnerSections => ({
  stats: initialDashboardSection(),
  occupancy: initialDashboardSection(),
  todaySchedule: initialDashboardSection(),
  upcomingAppointments: initialDashboardSection(),
  employees: initialDashboardSection(),
  popularServices: initialDashboardSection(),
  topClients: initialDashboardSection(),
});

function formatTime(value: string, timeZone = DEFAULT_SALON_TIME_ZONE) {
  return new Date(value).toLocaleTimeString("sr-RS", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  });
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("sr-RS", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function getEmployeeLabel(employee: {
  display_name: string | null;
  full_name: string;
}) {
  return employee.display_name || employee.full_name;
}

function getEmployeeColumns(
  schedule: AppointmentListItem[],
  employees: CalendarEmployee[]
): EmployeeColumn[] {
  const columns = new Map<string, EmployeeColumn>();

  schedule.forEach((appointment) => {
    const employee = appointment.employees;

    if (!employee) {
      return;
    }

    columns.set(employee.id, {
      id: employee.id,
      name: getEmployeeLabel(employee),
    });
  });

  employees.forEach((employee) => {
    if (columns.size >= MAX_MINI_CALENDAR_COLUMNS) {
      return;
    }

    columns.set(employee.id, {
      id: employee.id,
      name: getEmployeeLabel(employee),
    });
  });

  return [...columns.values()].slice(0, MAX_MINI_CALENDAR_COLUMNS);
}

function getCalendarEvents(schedule: AppointmentListItem[], timeZone: string) {
  return schedule.map((appointment) => {
    const start = new Date(appointment.start_time);
    const row = getHourInTimeZone(start, timeZone);

    return {
      id: appointment.id,
      row,
      employeeId: appointment.employees?.id ?? null,
      label: `${formatTime(appointment.start_time, timeZone)} ${appointment.clients?.full_name ?? "Klijent nije dostupan"}`,
    };
  });
}

// A failed query is never shown as zero: without data the section says it is unavailable; after a failed refresh
// the last successful data stays visible and is marked as previously loaded.
function SectionNotice({ section, onRetry }: { section: DashboardSection<unknown>; onRetry: () => void }) {
  if (section.status !== "error") return null;
  return <div className={section.stale ? "dashboard-section-stale" : "dashboard-section-unavailable"} role="status">
    <span>{section.stale ? "Prethodno učitani podaci — osvežavanje nije uspelo." : "Nije dostupno"}</span>
    <button type="button" onClick={onRetry}>Pokušaj ponovo</button>
  </div>;
}

function KpiCard({ label, section, onRetry, children }: {
  label: string;
  section: DashboardSection<unknown>;
  onRetry: () => void;
  children: ReactNode;
}) {
  return <article className="dashboard-card dashboard-kpi-card" aria-busy={section.status === "loading"}>
    <span className="dashboard-kpi-label">{label}</span>
    {section.data === null
      ? section.status === "loading"
        ? <strong className="dashboard-kpi-value dashboard-kpi-value--muted">…</strong>
        : <strong className="dashboard-kpi-value dashboard-kpi-value--muted">Nije dostupno</strong>
      : children}
    {section.status === "error" && <div className={section.stale ? "dashboard-kpi-stale" : "dashboard-kpi-retry"}>
      {section.stale && <small>Prethodno učitano</small>}
      <button type="button" onClick={onRetry}>Pokušaj ponovo</button>
    </div>}
  </article>;
}

function OwnerDashboard() {
  const { currentSalon, salonLoading } = useSalon();
  const [sections, setSections] = useState<OwnerSections>(initialSections);
  const [firstLoadDone, setFirstLoadDone] = useState(false);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const loadedSalonRef = useRef<string | null>(null);

  const salonTimeZone = currentSalon?.timezone || DEFAULT_SALON_TIME_ZONE;
  const today = getTodayDateKey(salonTimeZone);
  const todaySchedule = useMemo(() => sections.todaySchedule.data ?? [], [sections.todaySchedule.data]);
  const employees = useMemo(() => sections.employees.data ?? [], [sections.employees.data]);
  const employeeColumns = useMemo(
    () => getEmployeeColumns(todaySchedule, employees),
    [todaySchedule, employees]
  );
  const calendarEvents = useMemo(
    () => getCalendarEvents(todaySchedule, salonTimeZone),
    [salonTimeZone, todaySchedule],
  );
  const displayHours = useMemo(
    () =>
      [...new Set([
        ...DEFAULT_DASHBOARD_HOURS,
        ...calendarEvents.map((event) => event.row),
      ])].sort((first, second) => first - second),
    [calendarEvents],
  );
  const todayLabel = new Intl.DateTimeFormat("sr-Latn-RS", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: salonTimeZone,
  }).format(new Date());

  const loadDashboardData = useCallback(() => {
    if (!currentSalon) return Promise.resolve();
    if (inFlightRef.current) return inFlightRef.current;

    // Another salon: do not show the previous salon's data as "previously loaded".
    if (loadedSalonRef.current !== currentSalon.id) {
      loadedSalonRef.current = currentSalon.id;
      setSections(initialSections());
      setFirstLoadDone(false);
    }
    const request = loadOwnerDashboardSections({
      stats: () => getDashboardStats(currentSalon.id, salonTimeZone),
      occupancy: () => getTodayOccupancy(currentSalon.id, salonTimeZone),
      todaySchedule: () => getTodaySchedule(currentSalon.id, today, salonTimeZone),
      upcomingAppointments: () => getUpcomingAppointments(currentSalon.id),
      employees: () => getCalendarEmployees(currentSalon.id),
      popularServices: () => getPopularServices(currentSalon.id, salonTimeZone),
      topClients: () => getTopClients(currentSalon.id, salonTimeZone),
    }).then((result) => {
      setSections((previous) => {
        const next = { ...previous };
        for (const name of Object.keys(result) as DashboardSectionName[]) {
          const section = result[name];
          // Each key keeps its own value type; the loop only rewraps the same section.
          (next as Record<DashboardSectionName, DashboardSection<unknown>>)[name] = applyDashboardSectionResult(
            previous[name] as DashboardSection<unknown>,
            section.status === "fulfilled" ? { status: "fulfilled", value: section.value } : { status: "rejected" },
          );
        }
        return next;
      });

      const failed = Object.entries(result).filter(([, section]) => section.status === "rejected");
      if (failed.length > 0) {
        console.warn("OWNER_DASHBOARD_PARTIAL_LOAD", {
          sections: Object.entries(result).flatMap(([name, section]) =>
            section.status === "rejected"
              ? [{ name, code: section.errorCode, durationMs: Math.round(section.durationMs) }]
              : [],
          ),
        });
      }
    }).finally(() => {
      setFirstLoadDone(true);
      if (inFlightRef.current === request) inFlightRef.current = null;
    });
    inFlightRef.current = request;
    return request;
  }, [currentSalon, salonTimeZone, today]);

  useEffect(() => {
    const refreshDashboard = () => {
      void loadDashboardData();
    };

    refreshDashboard();
    window.addEventListener("rezervo:appointment-status-changed", refreshDashboard);

    return () => {
      window.removeEventListener(
        "rezervo:appointment-status-changed",
        refreshDashboard
      );
    };
  }, [loadDashboardData]);

  const retry = () => void loadDashboardData();

  if (salonLoading || !firstLoadDone) {
    return <p>Učitavanje kontrolne table…</p>;
  }

  if (!currentSalon) {
    return <p>Salon nije izabran.</p>;
  }

  const stats = sections.stats.data;
  const occupancy = sections.occupancy.data;
  const scheduleUnavailable = sections.todaySchedule.status === "error" && sections.todaySchedule.data === null;

  return (
    <main className="dashboard-page">
      <header>
        <h1>Rezervo Dashboard</h1>
        <p>Pregled ključnih metrika i narednih termina za {currentSalon.name}.</p>
      </header>

      <section className="dashboard-top-kpi">
        <KpiCard label="Današnji termini" section={sections.stats} onRetry={retry}>
          <strong className="dashboard-kpi-value">{stats?.todayAppointments}</strong>
          <small className="dashboard-kpi-meta">Na čekanju, potvrđeni i završeni</small>
        </KpiCard>

        <KpiCard label="Zauzeće danas" section={sections.occupancy} onRetry={retry}>
          {occupancy?.percent === null || occupancy === null ? (
            <>
              <strong className="dashboard-kpi-value">—</strong>
              <small className="dashboard-kpi-meta">Danas nema radnog vremena</small>
            </>
          ) : (
            <>
              <strong className="dashboard-kpi-value">{occupancy.percent}%</strong>
              <small className="dashboard-kpi-meta">Zauzeto radno vreme aktivnih zaposlenih</small>
            </>
          )}
        </KpiCard>

        <KpiCard label="Naredni termin" section={sections.stats} onRetry={retry}>
          {stats?.nextAppointment ? (
            <>
              <strong className="dashboard-kpi-value">{formatTime(stats.nextAppointment.start_time, salonTimeZone)}</strong>
              <small className="dashboard-kpi-meta">{stats.nextAppointment.clients?.full_name ?? "Neimenovan klijent"}</small>
            </>
          ) : (
            <strong className="dashboard-kpi-value">Nema termina</strong>
          )}
        </KpiCard>

        <KpiCard label="Mesečni prihod" section={sections.stats} onRetry={retry}>
          <strong className="dashboard-kpi-value">{formatCurrency(stats?.monthlyRevenue ?? 0)}</strong>
          <small className="dashboard-kpi-meta">Suma završenih termina</small>
        </KpiCard>

        <KpiCard label="Novi kartoni klijenata ovog meseca" section={sections.stats} onRetry={retry}>
          <strong className="dashboard-kpi-value">{stats?.monthlyNewClients}</strong>
          <small className="dashboard-kpi-meta">Kartoni napravljeni ovog meseca</small>
        </KpiCard>
      </section>

      <section className="dashboard-mid-grid">
        <div>
          <article className="dashboard-card dashboard-calendar-card">
            <div className="dashboard-card-header">
              <div>
                <h2>Kalendar danas</h2>
                <p>Mini pregled termina za {todayLabel}</p>
              </div>
              <Link href="/calendar">Pogledaj ceo kalendar</Link>
            </div>
            <SectionNotice section={sections.todaySchedule} onRetry={retry} />
            {sections.todaySchedule.status !== "error" && <SectionNotice section={sections.employees} onRetry={retry} />}

            {scheduleUnavailable ? null : employeeColumns.length === 0 ? (
              <div className="dashboard-calendar-empty">
                Nema aktivnih zaposlenih ni termina za danas.
              </div>
            ) : (
              <div
                className="dashboard-calendar-grid"
                style={{
                  gridTemplateColumns: `58px repeat(${employeeColumns.length}, minmax(120px, 1fr))`,
                }}
              >
                <div className="calendar-time"></div>
                {employeeColumns.map((employee) => (
                  <div key={employee.id} className="calendar-column-name">{employee.name}</div>
                ))}

                {displayHours.map((hour) => (
                  <React.Fragment key={hour}>
                    <div className="calendar-time">{hour}:00</div>
                    {employeeColumns.map((employee) => {
                      const cellEvents = calendarEvents.filter(
                        (item) => item.row === hour && item.employeeId === employee.id
                      );

                      return (
                        <div key={`${hour}-${employee.id}`} className="calendar-cell">
                          {cellEvents.map((event) => (
                            <div className="dashboard-calendar-event" key={event.id}>
                              {event.label}
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </React.Fragment>
                ))}
              </div>
            )}
            {todaySchedule.length > 0 && (
              <ul className="dashboard-calendar-mobile" aria-label="Današnji termini">
                {[...todaySchedule]
                  .sort(
                    (first, second) =>
                      new Date(first.start_time).getTime() -
                      new Date(second.start_time).getTime(),
                  )
                  .map((appointment) => (
                    <li key={appointment.id}>
                      <time>{formatTime(appointment.start_time, salonTimeZone)}</time>
                      <div>
                        <strong>
                          {appointment.clients?.full_name ?? "Klijent nije dostupan"}
                        </strong>
                        <span>
                          {appointment.services?.name ?? "Usluga nije dostupna"}
                        </span>
                        <small>
                          {appointment.employees?.display_name ||
                            appointment.employees?.full_name ||
                            "Zaposleni nije dostupan"}
                        </small>
                      </div>
                      <span className="dashboard-calendar-mobile__status">
                        {formatAppointmentStatus(appointment.status)}
                      </span>
                    </li>
                  ))}
              </ul>
            )}
          </article>

          <article className="dashboard-card">
            <div className="dashboard-card-header">
              <div>
                <h2>Naredni termini</h2>
                <p>Pet sledećih termina</p>
              </div>
            </div>
            <SectionNotice section={sections.upcomingAppointments} onRetry={retry} />

            {sections.upcomingAppointments.data !== null && (
              <ul className="dashboard-list">
                {sections.upcomingAppointments.data.length === 0 ? (
                  <li className="dashboard-list-item">Nema budućih termina.</li>
                ) : (
                  sections.upcomingAppointments.data.map((appointment) => (
                    <li key={appointment.id} className="dashboard-list-item">
                      <strong>{formatTime(appointment.start_time, salonTimeZone)}</strong>
                      <p>{appointment.clients?.full_name ?? "Neimenovan klijent"}</p>
                      <p>{appointment.services?.name ?? "Bez usluge"}</p>
                      <p>{appointment.employees?.display_name || appointment.employees?.full_name || "Nema zaposlenog"}</p>
                      <small>{formatAppointmentStatus(appointment.status)}</small>
                    </li>
                  ))
                )}
              </ul>
            )}
          </article>
        </div>

        <aside>
          <article className="dashboard-card dashboard-stat-summary">
            <div className="dashboard-card-header">
              <div>
                <h2>Statistika meseca</h2>
                <p>Brzi pregled bez grafikona.</p>
              </div>
            </div>
            <SectionNotice section={sections.stats} onRetry={retry} />
            {stats && <>
              <div className="dashboard-stat-row">
                <span>Ukupan prihod</span>
                <strong>{formatCurrency(stats.monthlyRevenue)}</strong>
              </div>
              <div className="dashboard-stat-row">
                <span>Realizovani termini</span>
                <strong>{stats.monthlyAppointments}</strong>
              </div>
              <div className="dashboard-stat-row">
                <span>Novi kartoni klijenata</span>
                <strong>{stats.monthlyNewClients}</strong>
              </div>
            </>}
          </article>
        </aside>
      </section>

      <section className="dashboard-bottom-grid">
        <article className="dashboard-card">
          <div className="dashboard-card-header">
            <div>
              <h2>Popularne usluge</h2>
              <p>Najviše završenih termina po usluzi ovog meseca.</p>
            </div>
          </div>
          <SectionNotice section={sections.popularServices} onRetry={retry} />
          {sections.popularServices.data !== null && (
            <ul className="dashboard-list">
              {sections.popularServices.data.length === 0 ? (
                <li className="dashboard-list-item">Nema završenih termina ovog meseca.</li>
              ) : (
                sections.popularServices.data.map((service) => (
                  <li key={service.serviceId} className="dashboard-list-item">
                    <strong>{service.name}</strong>
                    <span>{service.appointments} termina</span>
                  </li>
                ))
              )}
            </ul>
          )}
        </article>

        <article className="dashboard-card">
          <div className="dashboard-card-header">
            <div>
              <h2>Top klijenti</h2>
              <p>Po ukupnoj potrošnji u ovom mesecu.</p>
            </div>
          </div>
          <SectionNotice section={sections.topClients} onRetry={retry} />
          {sections.topClients.data !== null && (
            <ul className="dashboard-list">
              {sections.topClients.data.length === 0 ? (
                <li className="dashboard-list-item">Nema završenih poseta ovog meseca.</li>
              ) : (
                sections.topClients.data.map((client) => (
                  <li key={client.clientId} className="dashboard-list-item">
                    <strong>{client.fullName}</strong>
                    <p>{client.appointmentCount} realizovanih poseta</p>
                    <p>{formatCurrency(client.totalPrice)}</p>
                  </li>
                ))
              )}
            </ul>
          )}
        </article>
      </section>
    </main>
  );
}

export default function DashboardPage() {
  const { currentRole, currentEmployee, currentSalon } = useAuthorization();

  if (currentRole === "employee" && currentEmployee && currentSalon) {
    return (
      <EmployeeDashboard
        employee={currentEmployee}
        salon={currentSalon}
      />
    );
  }

  return <OwnerDashboard />;
}
