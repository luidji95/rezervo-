"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { useSalon } from "@/context/SalonContext";
import { getSalonEmployees } from "@/services/employeeService";
import {
  createClosure,
  deleteClosure,
  getSalonClosures,
} from "@/services/closureService";

import type { Employee } from "@/types/employee";
import type { Closure } from "@/types/closure";

import {
  closureSchema,
  type ClosureFormInput,
  type ClosureFormData,
} from "./closureSchema";

export default function ClosuresPage() {
  const { currentSalon } = useSalon();

  const [closures, setClosures] = useState<Closure[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ClosureFormInput, unknown, ClosureFormData>({
    resolver: zodResolver(closureSchema),
    defaultValues: {
      employee_id: "",
      title: "",
      reason: "",
      starts_at: "",
      ends_at: "",
      is_full_day: false,
    },
  });

  useEffect(() => {
    if (!currentSalon?.id) return;

    const salonId = currentSalon.id;
    let ignore = false;

    Promise.all([getSalonClosures(salonId), getSalonEmployees(salonId)])
      .then(([closuresData, employeesData]) => {
        if (!ignore) {
          setClosures(closuresData);
          setEmployees(employeesData);
        }
      })
      .catch((error) => console.error(error))
      .finally(() => {
        if (!ignore) {
          setLoading(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, [currentSalon?.id]);

  async function refreshClosures() {
    if (!currentSalon?.id) return;

    const updated = await getSalonClosures(currentSalon.id);
    setClosures(updated);
  }

  function rangesOverlap(
  startA: string,
  endA: string,
  startB: string,
  endB: string
) {
  return new Date(startA) < new Date(endB) && new Date(endA) > new Date(startB);
}

  async function onSubmit(data: ClosureFormData) {
  if (!currentSalon?.id) return;

  const finalStartsAt = new Date(data.starts_at);

  const finalEndsAt = data.is_full_day
    ? new Date(data.starts_at)
    : new Date(data.ends_at);

  if (data.is_full_day) {
    finalStartsAt.setHours(0, 0, 0, 0);
    finalEndsAt.setHours(23, 59, 59, 999);
  }

  const isoStart = finalStartsAt.toISOString();
  const isoEnd = finalEndsAt.toISOString();
  const newEmployeeId = data.employee_id || null;

  const hasConflict = closures.some((closure) => {
    const isOverlapping = rangesOverlap(
      isoStart,
      isoEnd,
      closure.starts_at,
      closure.ends_at
    );

    if (!isOverlapping) return false;

    const existingIsSalonWide = closure.employee_id === null;
    const newIsSalonWide = newEmployeeId === null;
    const sameEmployee = closure.employee_id === newEmployeeId;

    return existingIsSalonWide || newIsSalonWide || sameEmployee;
  });

  if (hasConflict) {
    alert("This closure overlaps with an existing salon or employee closure.");
    return;
  }

  try {
    await createClosure({
      salon_id: currentSalon.id,
      employee_id: newEmployeeId,
      title: data.title,
      reason: data.reason || null,
      starts_at: isoStart,
      ends_at: isoEnd,
      is_full_day: data.is_full_day,
      created_by: null,
    });

    await refreshClosures();
    reset();
  } catch (err) {
    console.error("Greška pri kreiranju:", err);
  }
}

  async function handleDeleteClosure(id: string) {
    await deleteClosure(id);
    await refreshClosures();
  }

  if (loading) {
    return <p>Loading closures...</p>;
  }

  return (
    <div>
      <h1>Closures / Time Off</h1>

      <p>Add salon-wide closures or time off for a specific employee.</p>

      <form onSubmit={handleSubmit(onSubmit)}>
        <div>
          <label>Applies to</label>

          <select {...register("employee_id")}>
            <option value="">Whole salon</option>

            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.display_name || employee.full_name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label>Title</label>
          <input {...register("title")} placeholder="Vacation, Sick leave..." />
          {errors.title && <p>{errors.title.message}</p>}
        </div>

        <div>
          <label>Reason</label>
          <textarea {...register("reason")} />
          {errors.reason && <p>{errors.reason.message}</p>}
        </div>

        <div>
          <label>Starts at</label>
          <input type="datetime-local" {...register("starts_at")} />
          {errors.starts_at && <p>{errors.starts_at.message}</p>}
        </div>

        <div>
          <label>Ends at</label>
          <input type="datetime-local" {...register("ends_at")} />
          {errors.ends_at && <p>{errors.ends_at.message}</p>}
        </div>

        <label>
          <input type="checkbox" {...register("is_full_day")} />
          Full day closure
        </label>

        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Saving..." : "Create closure"}
        </button>
      </form>

      <hr />

      <h2>Existing closures</h2>

      {closures.length === 0 ? (
        <p>No closures yet.</p>
      ) : (
        <div>
          {closures.map((closure) => {
            const employee = employees.find(
              (item) => item.id === closure.employee_id
            );

            return (
              <div
                key={closure.id}
                style={{
                  border: "1px solid #333",
                  padding: "16px",
                  marginBottom: "12px",
                  borderRadius: "8px",
                }}
              >
                <h3>{closure.title}</h3>

                <p>
                  Applies to:{" "}
                  {employee
                    ? employee.display_name || employee.full_name
                    : "Whole salon"}
                </p>

                {closure.reason && <p>Reason: {closure.reason}</p>}

                <p>From: {new Date(closure.starts_at).toLocaleString()}</p>

                <p>To: {new Date(closure.ends_at).toLocaleString()}</p>

                <p>{closure.is_full_day ? "Full day" : "Partial closure"}</p>

                <button onClick={() => handleDeleteClosure(closure.id)}>
                  Delete
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}