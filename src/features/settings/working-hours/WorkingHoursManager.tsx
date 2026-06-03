"use client";

import { useCallback, useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { useSalon } from "@/context/SalonContext";
import {
  getEmployeeWorkingHours,
  getSalonWorkingHours,
  upsertWorkingHour,
} from "@/services/workingService";
import { getSalonEmployees } from "@/services/employeeService";

import type { Employee } from "@/types/employee";
import type { WorkingHour } from "@/types/workingHour";
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

export default function WorkingHoursManager() {
  const { currentSalon, salonLoading } = useSalon();

  const [salonWorkingHours, setSalonWorkingHours] = useState<WorkingHour[]>([]);
  const [employeeWorkingHours, setEmployeeWorkingHours] = useState<WorkingHour[]>([]);
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

        const [hoursData, employeesData] = await Promise.all([
          getSalonWorkingHours(salonId),
          getSalonEmployees(salonId),
        ]);

        if (!ignore) {
          setSalonWorkingHours(hoursData);
          setEmployees(employeesData);
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

  const activeEmployeeWorkingHours = selectedEmployeeId
    ? employeeWorkingHours
    : [];

  if (salonLoading || loading) {
    return (
      <div className="settings-card">
        <p>Učitavanje radnog vremena...</p>
      </div>
    );
  }

  if (!currentSalon) {
    return (
      <div className="settings-card">
        <p style={{ color: "#dc2626" }}>Salon nije pronađen.</p>
      </div>
    );
  }

  return (
    <div className="working-hours-manager">
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
                salonId={currentSalon.id}
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
      className={`working-hours-row ${!isWorkingDay ? "working-hours-row--disabled" : ""}`}
    >
      <input type="hidden" {...register("day_of_week")} />

      <div className="working-hours-day">
        <span>{dayLabel}</span>

        {isUsingSalonDefault && (
          <small>Koristi vreme salona</small>
        )}
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
        <input
          type="time"
          disabled={!isWorkingDay}
          {...register("break_starts_at")}
        />
        <span>-</span>
        <input
          type="time"
          disabled={!isWorkingDay}
                    {...register("break_ends_at")}
        />

        {(errors.break_starts_at || errors.break_ends_at) && (
          <small className="working-hours-error">
            {errors.break_starts_at?.message ||
              errors.break_ends_at?.message}
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