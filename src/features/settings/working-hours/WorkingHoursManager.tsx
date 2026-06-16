"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, Clock, Moon, Sun } from "lucide-react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { useSalon } from "@/context/SalonContext";
import {
  getEmployeeWorkingHours,
  getSalonWorkingHours,
  upsertWorkingHour,
} from "@/services/workingService";
import { getSalonEmployees } from "@/services/employeeService";
import { getSalonClosures } from "@/services/closureService";

import type { Employee } from "@/types/employee";
import type { WorkingHour } from "@/types/workingHour";
import type { Closure } from "@/types/closure";
import {
  workingHourSchema,
  type WorkingHourFormInput,
  type WorkingHourFormData,
} from "./workingHourSchema";

const DAYS = [
  { value: 1, label: "Ponedeljak" },
  { value: 2, label: "Utorak" },
  { value: 3, label: "Sreda" },
  { value: 4, label: "Četvrtak" },
  { value: 5, label: "Petak" },
  { value: 6, label: "Subota" },
  { value: 0, label: "Nedelja" },
];

function toTimeInputValue(time?: string | null) {
  if (!time) return "";
  return time.slice(0, 5);
}

function timeToMinutes(time?: string | null) {
  if (!time) return 0;

  const [hours, minutes] = time.slice(0, 5).split(":").map(Number);
  return hours * 60 + minutes;
}

function formatMinutes(totalMinutes: number) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}min`;
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat("sr-RS", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(date));
}

function formatClosureTime(closure: Closure) {
  if (closure.is_full_day) return "Zatvoreno";

  return `${toTimeInputValue(closure.starts_at)} - ${toTimeInputValue(
    closure.ends_at
  )}`;
}

export default function WorkingHoursManager() {
  const { currentSalon, salonLoading } = useSalon();

  const [salonWorkingHours, setSalonWorkingHours] = useState<WorkingHour[]>([]);
  const [employeeWorkingHours, setEmployeeWorkingHours] = useState<WorkingHour[]>([]);
  const [closures, setClosures] = useState<Closure[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [loading, setLoading] = useState(true);

  const salonId = currentSalon?.id;
  const isEmployeeMode = Boolean(selectedEmployeeId);

  useEffect(() => {
    if (!salonId) return;

    let ignore = false;

    async function loadInitialData() {
      try {
        setLoading(true);

        const [hoursData, employeesData, closuresData] = await Promise.all([
          getSalonWorkingHours(salonId),
          getSalonEmployees(salonId),
          getSalonClosures(salonId),
        ]);

        if (!ignore) {
          setSalonWorkingHours(hoursData);
          setEmployees(employeesData);
          setClosures(closuresData);
        }
      } catch (error) {
        console.error("Greška pri učitavanju radnog vremena:", error);
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    loadInitialData();

    return () => {
      ignore = true;
    };
  }, [salonId]);

  useEffect(() => {
    if (!salonId || !selectedEmployeeId) return;

    let ignore = false;

    async function loadEmployeeHours() {
      try {
        const data = await getEmployeeWorkingHours(salonId, selectedEmployeeId);

        if (!ignore) {
          setEmployeeWorkingHours(data);
        }
      } catch (error) {
        console.error("Greška pri učitavanju sati zaposlenog:", error);
      }
    }

    loadEmployeeHours();

    return () => {
      ignore = true;
    };
  }, [salonId, selectedEmployeeId]);

  const refreshWorkingHours = useCallback(async () => {
    if (!salonId) return;

    if (selectedEmployeeId) {
      const updated = await getEmployeeWorkingHours(salonId, selectedEmployeeId);
      setEmployeeWorkingHours(updated);
      return;
    }

    const updated = await getSalonWorkingHours(salonId);
    setSalonWorkingHours(updated);
  }, [salonId, selectedEmployeeId]);

  const displayedWorkingHours = useMemo(() => {
    return DAYS.map((day) => {
      const employeeOverride = employeeWorkingHours.find(
        (hour) => hour.day_of_week === day.value
      );

      const salonHour = salonWorkingHours.find(
        (hour) => hour.day_of_week === day.value
      );

      return employeeOverride ?? salonHour;
    }).filter(Boolean) as WorkingHour[];
  }, [employeeWorkingHours, salonWorkingHours]);

  const summary = useMemo(() => {
    const workingDays = displayedWorkingHours.filter((hour) => hour.is_working_day);

    const totalMinutes = workingDays.reduce((total, hour) => {
      const workMinutes =
        timeToMinutes(hour.closes_at) - timeToMinutes(hour.opens_at);

      const breakMinutes =
        hour.break_starts_at && hour.break_ends_at
          ? timeToMinutes(hour.break_ends_at) - timeToMinutes(hour.break_starts_at)
          : 0;

      return total + Math.max(workMinutes - breakMinutes, 0);
    }, 0);

    const earliest = workingDays.length
      ? workingDays.reduce((min, hour) =>
          timeToMinutes(hour.opens_at) < timeToMinutes(min) ? hour.opens_at : min
        , workingDays[0].opens_at)
      : null;

    const latest = workingDays.length
      ? workingDays.reduce((max, hour) =>
          timeToMinutes(hour.closes_at) > timeToMinutes(max) ? hour.closes_at : max
        , workingDays[0].closes_at)
      : null;

    return {
      totalWeeklyHours: formatMinutes(totalMinutes),
      earliestTime: earliest ? toTimeInputValue(earliest) : "-",
      latestTime: latest ? toTimeInputValue(latest) : "-",
      workingDaysCount: workingDays.length,
      freeDaysCount: 7 - workingDays.length,
    };
  }, [displayedWorkingHours]);

  const specialClosures = useMemo(() => {
    return closures
      .filter((closure) => closure.employee_id === null)
      .slice(0, 4);
  }, [closures]);

  const activeEmployeeWorkingHours = selectedEmployeeId ? employeeWorkingHours : [];

  if (salonLoading || loading) {
    return (
      <div className="settings-card">
        <p>Učitavanje radnog vremena...</p>
      </div>
    );
  }

  if (!currentSalon || !salonId) {
    return (
      <div className="settings-card">
        <p className="settings-error-text">Salon nije pronađen.</p>
      </div>
    );
  }

  return (
    <div className="working-hours-layout">
      <div className="working-hours-main">
        <div className="working-hours-card">
          <div className="working-hours-header">
            <div>
              <h3>Radno vreme</h3>
              <p>
                Podesite radno vreme salona. Po potrebi možete izabrati zaposlenog
                i definisati posebne sate za njega.
              </p>
            </div>

            <div className="working-hours-mode">
              <label htmlFor="employee-select">Režim uređivanja</label>
              <select
                id="employee-select"
                value={selectedEmployeeId}
                onChange={(event) => setSelectedEmployeeId(event.target.value)}
              >
                <option value="">Podrazumevano vreme salona</option>

                {employees.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.display_name || employee.full_name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="working-hours-table">
            <div className="working-hours-table-head">
              <span>Dan</span>
              <span>Radno vreme</span>
              <span>Pauza</span>
              <span>Status</span>
              <span></span>
            </div>

            {DAYS.map((day) => {
              const employeeOverride = activeEmployeeWorkingHours.find(
                (hour) => hour.day_of_week === day.value
              );

              const salonHour = salonWorkingHours.find(
                (hour) => hour.day_of_week === day.value
              );

              const displayedHour = employeeOverride ?? salonHour;
              const isUsingSalonDefault = isEmployeeMode && !employeeOverride;

              return (
                <WorkingDayRow
                  key={`${selectedEmployeeId || "salon"}-${day.value}`}
                  salonId={salonId}
                  employeeId={selectedEmployeeId || null}
                  dayValue={day.value}
                  dayLabel={day.label}
                  existingHour={displayedHour}
                  isUsingSalonDefault={isUsingSalonDefault}
                  onSaved={refreshWorkingHours}
                />
              );
            })}
          </div>
        </div>
      </div>

      <aside className="working-hours-side">
        <section className="settings-card">
          <h3>Pregled radnog vremena</h3>

          <div className="working-stats-list">
            <WorkingStat
              icon={<Clock size={16} />}
              label="Ukupno radnih sati nedeljno"
              value={summary.totalWeeklyHours}
            />
            <WorkingStat
              icon={<Clock size={16} />}
              label="Najraniji termin"
              value={summary.earliestTime}
            />
            <WorkingStat
              icon={<Clock size={16} />}
              label="Najkasniji termin"
              value={summary.latestTime}
            />
            <WorkingStat
              icon={<CalendarDays size={16} />}
              label="Radnih dana"
              value={`${summary.workingDaysCount} dana`}
            />
            <WorkingStat
              icon={<Moon size={16} />}
              label="Slobodnih dana"
              value={`${summary.freeDaysCount} dan`}
            />
          </div>
        </section>

        <section className="settings-card">
          <div className="working-side-header">
            <div>
              <h3>Specijalni dani</h3>
              <p>Neradni dani i posebna zatvaranja salona.</p>
            </div>
          </div>

          {specialClosures.length === 0 ? (
            <p className="card-sub">Nema dodatih specijalnih dana.</p>
          ) : (
            <div className="special-days-list">
              {specialClosures.map((closure) => (
                <div key={closure.id} className="special-day-row">
                  <div className="special-day-icon">
                    <Sun size={16} />
                  </div>

                  <div className="special-day-content">
                    <strong>{formatDate(closure.starts_at)}</strong>
                    <span>{closure.title}</span>
                  </div>

                  <strong className="special-day-time">
                    {formatClosureTime(closure)}
                  </strong>
                </div>
              ))}
            </div>
          )}
        </section>
      </aside>
    </div>
  );
}

function WorkingStat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="working-stat-row">
      <div className="working-stat-left">
        <span className="working-stat-icon">{icon}</span>
        <span>{label}</span>
      </div>

      <strong>{value}</strong>
    </div>
  );
}

type WorkingDayRowProps = {
  salonId: string;
  employeeId: string | null;
  dayValue: number;
  dayLabel: string;
  existingHour: WorkingHour | undefined;
  isUsingSalonDefault: boolean;
  onSaved: () => Promise<void>;
};

function WorkingDayRow({
  salonId,
  employeeId,
  dayValue,
  dayLabel,
  existingHour,
  isUsingSalonDefault,
  onSaved,
}: WorkingDayRowProps) {
  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<WorkingHourFormInput, unknown, WorkingHourFormData>({
    resolver: zodResolver(workingHourSchema),
    values: {
      day_of_week: dayValue,
      opens_at: toTimeInputValue(existingHour?.opens_at) || "09:00",
      closes_at: toTimeInputValue(existingHour?.closes_at) || "17:00",
      break_starts_at: toTimeInputValue(existingHour?.break_starts_at),
      break_ends_at: toTimeInputValue(existingHour?.break_ends_at),
      is_working_day: existingHour?.is_working_day ?? true,
    },
  });

  const isWorkingDay = useWatch({
    control,
    name: "is_working_day",
  });

  async function onSubmit(data: WorkingHourFormData) {
    try {
      await upsertWorkingHour({
        salon_id: salonId,
        employee_id: employeeId,
        day_of_week: dayValue,
        opens_at: data.opens_at,
        closes_at: data.closes_at,
        break_starts_at: data.break_starts_at || null,
        break_ends_at: data.break_ends_at || null,
        is_working_day: data.is_working_day,
      });

      await onSaved();
    } catch (error) {
      console.error("Greška pri čuvanju radnog vremena:", error);
    }
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className={`working-hours-row ${
        !isWorkingDay ? "working-hours-row--disabled" : ""
      }`}
    >
      <input type="hidden" {...register("day_of_week")} />

      <div className="working-hours-day">
        <span>{dayLabel}</span>
        {isUsingSalonDefault && <small>Koristi vreme salona</small>}
      </div>

      <div className="working-hours-time-group">
        <input type="time" disabled={!isWorkingDay} {...register("opens_at")} />
        <span>-</span>
        <input type="time" disabled={!isWorkingDay} {...register("closes_at")} />

        {(errors.opens_at || errors.closes_at) && (
          <small className="working-hours-error">
            {errors.opens_at?.message || errors.closes_at?.message}
          </small>
        )}
      </div>

      <div className="working-hours-time-group">
        <input type="time" disabled={!isWorkingDay} {...register("break_starts_at")} />
        <span>-</span>
        <input type="time" disabled={!isWorkingDay} {...register("break_ends_at")} />

        {(errors.break_starts_at || errors.break_ends_at) && (
          <small className="working-hours-error">
            {errors.break_starts_at?.message || errors.break_ends_at?.message}
          </small>
        )}
      </div>

      <div className="working-hours-status">
        <label className="switch">
          <input type="checkbox" {...register("is_working_day")} />
          <span className="slider round" />
        </label>

        <span>{isWorkingDay ? "Aktivno" : "Neaktivno"}</span>
      </div>

      <button
        type="submit"
        className="working-hours-save-btn"
        disabled={isSubmitting}
      >
        {isSubmitting ? "Čuvanje..." : "Sačuvaj"}
      </button>
    </form>
  );
}