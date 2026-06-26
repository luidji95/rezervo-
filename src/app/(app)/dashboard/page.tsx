"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { useSalon } from "@/context/SalonContext";
import { getDashboardStats, type DashboardStats } from "@/services/dashboardStatsService";
import { getTodaySchedule, getUpcomingAppointments } from "@/services/dashboardAppointmentsService";
import { getPopularServices, getTopClients, type PopularService, type TopClient } from "@/services/dashboardAnalyticsService";
import { getCalendarEmployees, type CalendarEmployee } from "@/services/employeeQueryService";
import type { AppointmentListItem } from "@/services/appointmentQueryService";

import "./dashboard.css";

const HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17];
const MAX_MINI_CALENDAR_COLUMNS = 4;

type EmployeeColumn = {
  id: string;
  name: string;
};

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString("sr-RS", {
    hour: "2-digit",
    minute: "2-digit",
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

function getCalendarEvents(schedule: AppointmentListItem[]) {
  return schedule.map((appointment) => {
    const start = new Date(appointment.start_time);
    const row = start.getHours();

    return {
      id: appointment.id,
      row,
      employeeId: appointment.employees?.id ?? null,
      label: `${formatTime(appointment.start_time)} ${appointment.clients?.full_name ?? "Klijent"}`,
    };
  });
}

export default function DashboardPage() {
  const { currentSalon, salonLoading } = useSalon();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [todaySchedule, setTodaySchedule] = useState<AppointmentListItem[]>([]);
  const [upcomingAppointments, setUpcomingAppointments] = useState<AppointmentListItem[]>([]);
  const [employees, setEmployees] = useState<CalendarEmployee[]>([]);
  const [popularServices, setPopularServices] = useState<PopularService[]>([]);
  const [topClients, setTopClients] = useState<TopClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const today = new Date().toISOString().slice(0, 10);
  const employeeColumns = useMemo(
    () => getEmployeeColumns(todaySchedule, employees),
    [todaySchedule, employees]
  );
  const calendarEvents = useMemo(() => getCalendarEvents(todaySchedule), [todaySchedule]);

  useEffect(() => {
    async function loadDashboardData() {
      if (!currentSalon) return;

      setLoading(true);
      setError(null);

      try {
        const [statsData, todayScheduleData, upcomingData, employeesData, popularData, topClientsData] =
          await Promise.all([
            getDashboardStats(currentSalon.id),
            getTodaySchedule(currentSalon.id, today),
            getUpcomingAppointments(currentSalon.id),
            getCalendarEmployees(currentSalon.id),
            getPopularServices(currentSalon.id),
            getTopClients(currentSalon.id),
          ]);

        setStats(statsData);
        setTodaySchedule(todayScheduleData);
        setUpcomingAppointments(upcomingData);
        setEmployees(employeesData);
        setPopularServices(popularData);
        setTopClients(topClientsData);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error loading dashboard data.");
      } finally {
        setLoading(false);
      }
    }

    void loadDashboardData();
  }, [currentSalon, today]);

  if (salonLoading || loading) {
    return <p>Loading dashboard...</p>;
  }

  if (!currentSalon) {
    return <p>No salon selected.</p>;
  }

  if (error) {
    return <p>{error}</p>;
  }

  return (
    <main className="dashboard-page">
      <header>
        <h1>Rezervo Dashboard</h1>
        <p>Pregled ključnih metrika i narednih termina za {currentSalon.name}.</p>
      </header>

      <section className="dashboard-top-kpi">
        <article className="dashboard-card dashboard-kpi-card">
          <span className="dashboard-kpi-label">Današnji termini</span>
          <strong className="dashboard-kpi-value">{stats?.todayAppointments ?? 0}</strong>
          <small className="dashboard-kpi-meta">Realni termini za danas</small>
        </article>

        <article className="dashboard-card dashboard-kpi-card">
          <span className="dashboard-kpi-label">Zauzeće danas</span>
          <strong className="dashboard-kpi-value">{stats?.occupancyToday ?? 0}%</strong>
          <small className="dashboard-kpi-meta">Ukupno zauzeto radno vreme</small>
        </article>

        <article className="dashboard-card dashboard-kpi-card">
          <span className="dashboard-kpi-label">Naredni termin</span>
          {stats?.nextAppointment ? (
            <>
              <strong className="dashboard-kpi-value">{formatTime(stats.nextAppointment.start_time)}</strong>
              <small className="dashboard-kpi-meta">{stats.nextAppointment.clients?.full_name ?? "Neimenovan klijent"}</small>
            </>
          ) : (
            <strong className="dashboard-kpi-value">Nema termina</strong>
          )}
        </article>

        <article className="dashboard-card dashboard-kpi-card">
          <span className="dashboard-kpi-label">Mesečni prihod</span>
          <strong className="dashboard-kpi-value">{formatCurrency(stats?.monthlyRevenue ?? 0)}</strong>
          <small className="dashboard-kpi-meta">Suma završених termina</small>
        </article>

        <article className="dashboard-card dashboard-kpi-card">
          <span className="dashboard-kpi-label">Novi klijenti (mesec)</span>
          <strong className="dashboard-kpi-value">{stats?.monthlyNewClients ?? 0}</strong>
          <small className="dashboard-kpi-meta">Prvi termin ovog meseca</small>
        </article>
      </section>

      <section className="dashboard-mid-grid">
        <div>
          <article className="dashboard-card dashboard-calendar-card">
            <div className="dashboard-card-header">
              <div>
                <h2>Kalendar danas</h2>
                <p>Mini pregled termina za danas</p>
              </div>
              <Link href="/calendar">Pogledaj ceo kalendar</Link>
            </div>

            {employeeColumns.length === 0 ? (
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

                {HOURS.map((hour) => (
                  <React.Fragment key={hour}>
                    <div className="calendar-time">{hour}:00</div>
                    {employeeColumns.map((employee) => {
                      const event = calendarEvents.find(
                        (item) => item.row === hour && item.employeeId === employee.id
                      );

                      return (
                        <div key={`${hour}-${employee.id}`} className="calendar-cell">
                          {event ? <div className="dashboard-calendar-event">{event.label}</div> : null}
                        </div>
                      );
                    })}
                  </React.Fragment>
                ))}
              </div>
            )}
          </article>

          <article className="dashboard-card">
            <div className="dashboard-card-header">
              <div>
                <h2>Naredni termini</h2>
                <p>Pet sledećih termina</p>
              </div>
            </div>

            <ul className="dashboard-list">
              {upcomingAppointments.length === 0 ? (
                <li className="dashboard-list-item">Nema budućih termina.</li>
              ) : (
                upcomingAppointments.map((appointment) => (
                  <li key={appointment.id} className="dashboard-list-item">
                    <strong>{formatTime(appointment.start_time)}</strong>
                    <p>{appointment.clients?.full_name ?? "Neimenovan klijent"}</p>
                    <p>{appointment.services?.name ?? "Bez usluge"}</p>
                    <p>{appointment.employees?.display_name || appointment.employees?.full_name || "Nema zaposlenog"}</p>
                    <small>{appointment.status}</small>
                  </li>
                ))
              )}
            </ul>
          </article>
        </div>

        <aside>
          <article className="dashboard-card dashboard-activity-card">
            <div className="dashboard-card-header">
              <div>
                <h2>AI Receptionist aktivnost</h2>
                <p>Dummy placeholder za buduće WhatsApp / Instagram / SMS aktivnosti.</p>
              </div>
            </div>

            <ul className="dashboard-activity-list">
              <li className="dashboard-activity-item">
                <span>WhatsApp</span>
                <strong>0</strong>
              </li>
              <li className="dashboard-activity-item">
                <span>Instagram</span>
                <strong>0</strong>
              </li>
              <li className="dashboard-activity-item">
                <span>Voice AI</span>
                <strong>0</strong>
              </li>
              <li className="dashboard-activity-item">
                <span>SMS</span>
                <strong>0</strong>
              </li>
            </ul>
          </article>

          <article className="dashboard-card dashboard-stat-summary">
            <div className="dashboard-card-header">
              <div>
                <h2>Statistika meseca</h2>
                <p>Brzi pregled bez grafikona.</p>
              </div>
            </div>
            <div className="dashboard-stat-row">
              <span>Ukupan prihod</span>
              <strong>{formatCurrency(stats?.monthlyRevenue ?? 0)}</strong>
            </div>
            <div className="dashboard-stat-row">
              <span>Ukupno termina</span>
              <strong>{stats?.monthlyAppointments ?? 0}</strong>
            </div>
            <div className="dashboard-stat-row">
              <span>Novi klijenti</span>
              <strong>{stats?.monthlyNewClients ?? 0}</strong>
            </div>
          </article>
        </aside>
      </section>

      <section className="dashboard-bottom-grid">
        <article className="dashboard-card">
          <div className="dashboard-card-header">
            <div>
              <h2>Popularne usluge</h2>
              <p>Najviše zakazanih completed usluga ovog meseca.</p>
            </div>
          </div>
          <ul className="dashboard-list">
            {popularServices.length === 0 ? (
              <li className="dashboard-list-item">Nema podataka.</li>
            ) : (
              popularServices.map((service) => (
                <li key={service.serviceId} className="dashboard-list-item">
                  <strong>{service.name}</strong>
                  <span>{service.appointments} termina</span>
                </li>
              ))
            )}
          </ul>
        </article>

        <article className="dashboard-card">
          <div className="dashboard-card-header">
            <div>
              <h2>Top klijenti</h2>
              <p>Po ukupnoj potrošnji u ovom mesecu.</p>
            </div>
          </div>
          <ul className="dashboard-list">
            {topClients.length === 0 ? (
              <li className="dashboard-list-item">Nema podataka.</li>
            ) : (
              topClients.map((client) => (
                <li key={client.clientId} className="dashboard-list-item">
                  <strong>{client.fullName}</strong>
                  <p>{client.appointmentCount} termina</p>
                  <p>{formatCurrency(client.totalPrice)}</p>
                </li>
              ))
            )}
          </ul>
        </article>
      </section>
    </main>
  );
}
