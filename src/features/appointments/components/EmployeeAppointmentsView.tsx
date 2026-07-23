"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Plus,
  RefreshCw,
  Search,
  UserRound,
  UserX,
} from "lucide-react";

import EmployeeCreateAppointmentModal from "@/app/(app)/calendar/EmployeeCreateAppointmentModal";
import { useAuthorization } from "@/context/AuthorizationContext";
import {
  addDaysToDateKey,
  DEFAULT_SALON_TIME_ZONE,
  getDayOfWeekFromDateKey,
  getTodayDateKey,
} from "@/lib/salonDateTime";
import {
  EmployeeAppointmentError,
  updateOwnAppointmentStatus,
} from "@/services/employeeAppointmentService";
import type { AppointmentListItem } from "@/services/appointmentQueryService";
import {
  EMPLOYEE_APPOINTMENTS_PAGE_SIZE,
  getEmployeeAppointmentsKpis,
  getEmployeeAppointmentsPage,
  type EmployeeAppointmentsFilters,
} from "../services/employeeAppointmentsPageService";
import {
  getEmployeeAppointmentFinalMessage,
  getEmployeeAppointmentStatusActions,
  getEmployeeAppointmentStatusLabel,
  type EmployeeAppointmentStatusAction,
} from "../employeeAppointmentStatusTransitions";
import { EmployeeStatusConfirmationModal } from "./EmployeeStatusConfirmationModal";

const INITIAL_KPIS = { today: 0, upcoming: 0, completedThisWeek: 0, noShowThisWeek: 0 };

function getInitialFilters(todayKey: string): EmployeeAppointmentsFilters {
  return { period: "upcoming", status: "all", search: "", fromDate: todayKey, toDate: todayKey, page: 0 };
}

function formatDate(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("sr-RS", { day: "2-digit", month: "short", year: "numeric", timeZone }).format(new Date(value));
}

function formatTime(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("sr-RS", { hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(value));
}

function durationMinutes(appointment: AppointmentListItem) {
  return Math.max(0, Math.round((new Date(appointment.end_time).getTime() - new Date(appointment.start_time).getTime()) / 60000));
}

export function EmployeeAppointmentsView() {
  const { currentSalon, currentEmployee } = useAuthorization();
  const timeZone = currentSalon?.timezone || DEFAULT_SALON_TIME_ZONE;
  const todayKey = getTodayDateKey(timeZone);
  const [filters, setFilters] = useState(() => getInitialFilters(todayKey));
  const [appointments, setAppointments] = useState<AppointmentListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [kpis, setKpis] = useState(INITIAL_KPIS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<{ appointmentId: string; action: EmployeeAppointmentStatusAction } | null>(null);
  const [updating, setUpdating] = useState<{ appointmentId: string; status: string } | null>(null);

  const weekRange = useMemo(() => {
    const day = getDayOfWeekFromDateKey(todayKey);
    const monday = addDaysToDateKey(todayKey, day === 0 ? -6 : 1 - day);
    return { start: monday, end: addDaysToDateKey(monday, 7) };
  }, [todayKey]);

  const loadData = useCallback(async () => {
    if (!currentSalon || !currentEmployee) return;
    setLoading(true);
    setError("");
    const [pageResult, kpiResult] = await Promise.allSettled([
      getEmployeeAppointmentsPage({ salonId: currentSalon.id, employeeId: currentEmployee.id, timeZone, todayKey, filters }),
      getEmployeeAppointmentsKpis({ salonId: currentSalon.id, employeeId: currentEmployee.id, todayKey, weekStartKey: weekRange.start, weekEndKey: weekRange.end, timeZone }),
    ]);
    if (pageResult.status === "fulfilled") {
      setAppointments(pageResult.value.appointments);
      setTotal(pageResult.value.total);
    } else {
      setAppointments([]);
      setTotal(0);
      setError("Termine trenutno nije moguće učitati.");
    }
    if (kpiResult.status === "fulfilled") setKpis(kpiResult.value);
    setLoading(false);
  }, [currentEmployee, currentSalon, filters, timeZone, todayKey, weekRange]);

  useEffect(() => {
    const request = window.setTimeout(() => void loadData(), 0);
    return () => window.clearTimeout(request);
  }, [loadData]);

  useEffect(() => {
    const refresh = () => void loadData();
    window.addEventListener("focus", refresh);
    window.addEventListener("rezervo:appointment-status-changed", refresh);
    window.addEventListener("rezervo:appointment-created", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("rezervo:appointment-status-changed", refresh);
      window.removeEventListener("rezervo:appointment-created", refresh);
    };
  }, [loadData]);

  const patchFilters = (patch: Partial<EmployeeAppointmentsFilters>) => setFilters((current) => ({ ...current, ...patch, page: patch.page ?? 0 }));

  const runAction = async (appointmentId: string, action: EmployeeAppointmentStatusAction) => {
    if (updating) return;
    if (action.requiresConfirmation && pendingAction?.action.nextStatus !== action.nextStatus) {
      setPendingAction({ appointmentId, action });
      return;
    }
    setUpdating({ appointmentId, status: action.nextStatus });
    setError("");
    try {
      await updateOwnAppointmentStatus(appointmentId, action.nextStatus);
      setPendingAction(null);
    } catch (statusError) {
      setError(statusError instanceof EmployeeAppointmentError && ["INVALID_STATUS_TRANSITION", "APPOINTMENT_ALREADY_UPDATED"].includes(statusError.code)
        ? "Status je već promenjen. Lista je osvežena."
        : "Status termina trenutno nije moguće promeniti.");
      setPendingAction(null);
      await loadData();
    } finally {
      setUpdating(null);
    }
  };

  if (!currentSalon || !currentEmployee) return <p role="alert">Nalog zaposlenog nije pravilno povezan.</p>;

  const pageCount = Math.max(1, Math.ceil(total / EMPLOYEE_APPOINTMENTS_PAGE_SIZE));
  const employeeName = currentEmployee.display_name || currentEmployee.full_name;

  return (
    <main className="employee-appointments">
      <header className="employee-appointments__header">
        <div><span>Operativni pregled</span><h1>Moji termini</h1><p>{employeeName} · {currentSalon.name}</p></div>
        <button type="button" onClick={() => setCreateOpen(true)}><Plus size={18} /> Novi termin</button>
      </header>

      <section className="employee-appointments__kpis" aria-label="Pregled termina">
        <article><CalendarDays /><div><span>Danas</span><strong>{kpis.today}</strong></div></article>
        <article><Clock3 /><div><span>Predstojeći</span><strong>{kpis.upcoming}</strong></div></article>
        <article><CheckCircle2 /><div><span>Završeni ove nedelje</span><strong>{kpis.completedThisWeek}</strong></div></article>
        <article><UserX /><div><span>No-show ove nedelje</span><strong>{kpis.noShowThisWeek}</strong></div></article>
      </section>

      <section className="employee-appointments__panel">
        <div className="employee-appointments__filters">
          <label><span>Period</span><select value={filters.period} onChange={(event) => patchFilters({ period: event.target.value as EmployeeAppointmentsFilters["period"] })}><option value="upcoming">Danas i predstojeći</option><option value="today">Samo danas</option><option value="history">Istorija</option><option value="custom">Izabrani period</option></select></label>
          <label><span>Status</span><select value={filters.status} onChange={(event) => patchFilters({ status: event.target.value as EmployeeAppointmentsFilters["status"] })}><option value="all">Svi statusi</option><option value="pending">Na čekanju</option><option value="confirmed">Potvrđeno</option><option value="completed">Završeno</option><option value="cancelled">Otkazano</option><option value="no_show">Nije došao</option></select></label>
          <label className="employee-appointments__search"><span>Klijent</span><div><Search size={16} /><input value={filters.search} onChange={(event) => patchFilters({ search: event.target.value })} placeholder="Pretraži po imenu" /></div></label>
          {filters.period === "custom" && <><label><span>Od</span><input type="date" value={filters.fromDate} onChange={(event) => patchFilters({ fromDate: event.target.value })} /></label><label><span>Do</span><input type="date" min={filters.fromDate} value={filters.toDate} onChange={(event) => patchFilters({ toDate: event.target.value })} /></label></>}
        </div>

        {error && <div className="employee-appointments__error" role="alert"><span>{error}</span><button type="button" onClick={() => void loadData()}><RefreshCw size={16} /> Pokušaj ponovo</button></div>}

        {loading ? <div className="employee-appointments__skeleton" aria-label="Učitavanje termina">{Array.from({ length: 5 }, (_, index) => <div key={index} />)}</div> : appointments.length === 0 ? <div className="employee-appointments__empty"><CalendarDays size={34} /><h2>{filters.period === "today" ? "Danas nemate zakazanih termina." : filters.period === "history" ? "Još nemate istoriju termina." : "Nema termina za izabrane filtere."}</h2><p>Promenite filtere ili zakažite novi termin.</p></div> : <>
          <div className="employee-appointments__table-wrap"><table><thead><tr><th>Datum</th><th>Vreme</th><th>Klijent</th><th>Usluga</th><th>Trajanje</th><th>Status</th><th>Akcije</th></tr></thead><tbody>{appointments.map((appointment) => <tr key={appointment.id}><td>{formatDate(appointment.start_time, timeZone)}</td><td><strong>{formatTime(appointment.start_time, timeZone)}</strong><span>{formatTime(appointment.end_time, timeZone)}</span></td><td><strong>{appointment.clients?.full_name || "Klijent nije dostupan"}</strong><span>{appointment.clients?.phone || appointment.clients?.email || "Kontakt nije dostupan"}</span></td><td>{appointment.services?.name || "Usluga nije dostupna"}</td><td>{durationMinutes(appointment)} min</td><td><span className={`employee-status-badge employee-status-badge--${appointment.status}`}>{getEmployeeAppointmentStatusLabel(appointment.status)}</span></td><td><StatusActions appointment={appointment} updating={updating} onAction={runAction} /></td></tr>)}</tbody></table></div>
          <div className="employee-appointments__cards">{appointments.map((appointment) => <article key={appointment.id}><div><span>{formatDate(appointment.start_time, timeZone)}</span><span className={`employee-status-badge employee-status-badge--${appointment.status}`}>{getEmployeeAppointmentStatusLabel(appointment.status)}</span></div><h2>{appointment.clients?.full_name || "Klijent nije dostupan"}</h2><p><Clock3 size={15} /> {formatTime(appointment.start_time, timeZone)}–{formatTime(appointment.end_time, timeZone)} · {durationMinutes(appointment)} min</p><p><UserRound size={15} /> {appointment.services?.name || "Usluga nije dostupna"}</p><StatusActions appointment={appointment} updating={updating} onAction={runAction} /></article>)}</div>
        </>}

        {!loading && total > 0 && <footer className="employee-appointments__pagination"><span>{total} termina · Strana {filters.page + 1} od {pageCount}</span><div><button type="button" disabled={filters.page === 0} onClick={() => patchFilters({ page: filters.page - 1 })}><ChevronLeft size={17} /> Prethodna</button><button type="button" disabled={filters.page + 1 >= pageCount} onClick={() => patchFilters({ page: filters.page + 1 })}>Sledeća <ChevronRight size={17} /></button></div></footer>}
      </section>

      <EmployeeStatusConfirmationModal action={pendingAction?.action ?? null} loading={Boolean(updating)} onCancel={() => setPendingAction(null)} onConfirm={() => pendingAction && void runAction(pendingAction.appointmentId, pendingAction.action)} />
      {createOpen && <EmployeeCreateAppointmentModal isOpen onClose={() => setCreateOpen(false)} selectedDate={todayKey} salonTimeZone={timeZone} onCreated={async () => undefined} />}
    </main>
  );
}

function StatusActions({ appointment, updating, onAction }: { appointment: AppointmentListItem; updating: { appointmentId: string; status: string } | null; onAction: (id: string, action: EmployeeAppointmentStatusAction) => Promise<void> }) {
  const actions = getEmployeeAppointmentStatusActions(appointment.status);
  const finalMessage = getEmployeeAppointmentFinalMessage(appointment.status);
  if (actions.length === 0) return <p className="employee-appointments__final-state">{finalMessage || "Nema dostupnih akcija."}</p>;
  return <div className="employee-appointments__actions">{actions.map((action) => <button key={action.nextStatus} type="button" className={`employee-status-action employee-status-action--${action.tone}`} disabled={Boolean(updating)} onClick={() => void onAction(appointment.id, action)}>{updating?.appointmentId === appointment.id && updating.status === action.nextStatus ? action.loadingLabel : action.label}</button>)}</div>;
}
