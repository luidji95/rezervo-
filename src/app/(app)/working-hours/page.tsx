"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
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
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
  { value: 0, label: "Sunday" },
];

function toTimeInputValue(time?: string | null) {
  if (!time) return "";
  return time.slice(0, 5);
}

export default function WorkingHoursPage() {
  const { currentSalon } = useSalon();

  const [salonWorkingHours, setSalonWorkingHours] = useState<WorkingHour[]>([]);
  const [employeeWorkingHours, setEmployeeWorkingHours] = useState<
    WorkingHour[]
  >([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [loading, setLoading] = useState(true);

  const isEmployeeMode = Boolean(selectedEmployeeId);

  useEffect(() => {
    if (!currentSalon?.id) {
      setLoading(false);
      return;
    }

    const salonId = currentSalon.id;
    let ignore = false;

    async function loadInitialData() {
      try {
        const [hoursData, employeesData] = await Promise.all([
          getSalonWorkingHours(salonId),
          getSalonEmployees(salonId),
        ]);

        if (!ignore) {
          setSalonWorkingHours(hoursData);
          setEmployees(employeesData);
        }
      } catch (error) {
        console.error(error);
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    loadInitialData();

    return () => {
      ignore = true;
    };
  }, [currentSalon?.id]);

  useEffect(() => {
    if (!currentSalon?.id || !selectedEmployeeId) {
      setEmployeeWorkingHours([]);
      return;
    }

    const salonId = currentSalon.id;
    const employeeId = selectedEmployeeId;
    let ignore = false;

    async function loadEmployeeHours() {
      try {
        const data = await getEmployeeWorkingHours(salonId, employeeId);

        if (!ignore) {
          setEmployeeWorkingHours(data);
        }
      } catch (error) {
        console.error(error);
      }
    }

    loadEmployeeHours();

    return () => {
      ignore = true;
    };
  }, [currentSalon?.id, selectedEmployeeId]);

  async function refreshWorkingHours() {
    if (!currentSalon?.id) return;

    if (selectedEmployeeId) {
      const updated = await getEmployeeWorkingHours(
        currentSalon.id,
        selectedEmployeeId
      );

      setEmployeeWorkingHours(updated);
      return;
    }

    const updated = await getSalonWorkingHours(currentSalon.id);
    setSalonWorkingHours(updated);
  }

  function getSalonHourForDay(day: number) {
    return salonWorkingHours.find((hour) => hour.day_of_week === day);
  }

  function getEmployeeHourForDay(day: number) {
    return employeeWorkingHours.find((hour) => hour.day_of_week === day);
  }

  function getDisplayedHourForDay(day: number) {
    const employeeHour = getEmployeeHourForDay(day);
    const salonHour = getSalonHourForDay(day);

    return employeeHour ?? salonHour;
  }

  if (loading) {
    return <p>Loading working hours...</p>;
  }

  return (
    <div>
      <h1>Working Hours</h1>

      <p>
        Set salon default working hours or override hours for a specific
        employee.
      </p>

      <div style={{ marginBottom: "24px" }}>
        <label>Editing mode</label>

        <select
          value={selectedEmployeeId}
          onChange={(event) => setSelectedEmployeeId(event.target.value)}
        >
          <option value="">Salon default hours</option>

          {employees.map((employee) => (
            <option key={employee.id} value={employee.id}>
              {employee.display_name || employee.full_name}
            </option>
          ))}
        </select>
      </div>

      <div>
        {DAYS.map((day) => {
          const displayedHour = getDisplayedHourForDay(day.value);
          const employeeOverride = getEmployeeHourForDay(day.value);
          const isUsingSalonDefault = isEmployeeMode && !employeeOverride;

          return (
            <WorkingDayCard
              key={`${selectedEmployeeId || "salon"}-${day.value}`}
              salonId={currentSalon?.id}
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
  );
}

type WorkingDayCardProps = {
  salonId: string | undefined;
  employeeId: string | null;
  dayValue: number;
  dayLabel: string;
  existingHour: WorkingHour | undefined;
  isUsingSalonDefault: boolean;
  onSaved: () => Promise<void>;
};

function WorkingDayCard({
  salonId,
  employeeId,
  dayValue,
  dayLabel,
  existingHour,
  isUsingSalonDefault,
  onSaved,
}: WorkingDayCardProps) {
  const {
    register,
    handleSubmit,
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

  async function onSubmit(data: WorkingHourFormData) {
    if (!salonId) return;

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
      console.error(error);
    }
  }

  return (
    <div
      style={{
        border: isUsingSalonDefault ? "1px dashed #777" : "1px solid #333",
        padding: "16px",
        marginBottom: "16px",
        borderRadius: "8px",
      }}
    >
      <h3>{dayLabel}</h3>

      {isUsingSalonDefault && (
        <p style={{ fontSize: "14px", opacity: 0.7 }}>
          Using salon default hours. Saving will create an employee override.
        </p>
      )}

      <form onSubmit={handleSubmit(onSubmit)}>
        <input type="hidden" {...register("day_of_week")} />

        <div>
          <label>Opens at</label>
          <input type="time" {...register("opens_at")} />
          {errors.opens_at && <p>{errors.opens_at.message}</p>}
        </div>

        <div>
          <label>Closes at</label>
          <input type="time" {...register("closes_at")} />
          {errors.closes_at && <p>{errors.closes_at.message}</p>}
        </div>

        <div>
          <label>Break starts</label>
          <input type="time" {...register("break_starts_at")} />
          {errors.break_starts_at && <p>{errors.break_starts_at.message}</p>}
        </div>

        <div>
          <label>Break ends</label>
          <input type="time" {...register("break_ends_at")} />
          {errors.break_ends_at && <p>{errors.break_ends_at.message}</p>}
        </div>

        <label>
          <input type="checkbox" {...register("is_working_day")} />
          Working day
        </label>

        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Saving..." : `Save ${dayLabel}`}
        </button>
      </form>
    </div>
  );
}