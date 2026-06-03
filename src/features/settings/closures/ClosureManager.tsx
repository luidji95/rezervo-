"use client";

import { useCallback, useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Calendar, Plus, Trash2 } from "lucide-react";

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

function rangesOverlap(
  startA: string,
  endA: string,
  startB: string,
  endB: string
) {
  return new Date(startA) < new Date(endB) && new Date(endA) > new Date(startB);
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("sr-RS", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ClosuresManager() {
  const { currentSalon, salonLoading } = useSalon();

  const [closures, setClosures] = useState<Closure[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);

  const salonId = currentSalon?.id;

  useEffect(() => {
    if (!salonId) return;

    let ignore = false;

    async function loadData() {
      try {
        setLoading(true);

        const [closuresData, employeesData] = await Promise.all([
          getSalonClosures(salonId),
          getSalonEmployees(salonId),
        ]);

        if (!ignore) {
          setClosures(closuresData);
          setEmployees(employeesData);
        }
      } catch (error) {
        console.error("Greška pri učitavanju neradnih perioda:", error);
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    loadData();

    return () => {
      ignore = true;
    };
  }, [salonId]);

  const refreshClosures = useCallback(async () => {
    if (!salonId) return;

    const updated = await getSalonClosures(salonId);
    setClosures(updated);
  }, [salonId]);

  async function handleDeleteClosure(id: string) {
    const confirmed = window.confirm(
      "Da li sigurno želiš da obrišeš ovaj neradni period?"
    );

    if (!confirmed) return;

    await deleteClosure(id);
    await refreshClosures();
  }

  if (salonLoading || loading) {
    return (
      <div className="settings-card">
        <p>Učitavanje neradnih perioda...</p>
      </div>
    );
  }

  if (!currentSalon) {
    return (
      <div className="settings-card">
        <p>Salon nije pronađen.</p>
      </div>
    );
  }

  return (
    <div className="closures-manager">
      <div className="settings-card">
        <div className="card-header-actions">
          <div>
            <h3>Neradni periodi</h3>
            <p className="card-sub">
              Dodajte zatvaranja za ceo salon ili odsustva za pojedinačne
              zaposlene.
            </p>
          </div>

          {!isAdding && (
            <button
              type="button"
              className="btn-save"
              onClick={() => setIsAdding(true)}
            >
              <Plus size={16} />
              Dodaj period
            </button>
          )}
        </div>

        {isAdding && (
          <ClosureForm
            salonId={currentSalon.id}
            closures={closures}
            employees={employees}
            onCancel={() => setIsAdding(false)}
            onSuccess={async () => {
              setIsAdding(false);
              await refreshClosures();
            }}
          />
        )}
      </div>

      <div className="settings-card">
        <h3>Postojeći neradni periodi</h3>
        <p className="card-sub">
          Ovi periodi blokiraju dostupne termine u booking i reschedule flow-u.
        </p>

        {closures.length === 0 ? (
          <div className="closures-empty-state">
            <Calendar size={30} />
            <p>Nema dodatih neradnih perioda.</p>
          </div>
        ) : (
          <div className="closures-list">
            {closures.map((closure) => {
              const employee = employees.find(
                (item) => item.id === closure.employee_id
              );

              return (
                <div key={closure.id} className="closure-item">
                  <div>
                    <h4>{closure.title}</h4>

                    <p>
                      {employee
                        ? employee.display_name || employee.full_name
                        : "Ceo salon"}
                    </p>

                    {closure.reason && <p>{closure.reason}</p>}

                    <small>
                      {formatDateTime(closure.starts_at)} —{" "}
                      {formatDateTime(closure.ends_at)}
                    </small>

                    <span className="closure-badge">
                      {closure.is_full_day ? "Ceo dan" : "Delimično"}
                    </span>
                  </div>

                  <button
                    type="button"
                    className="closure-delete-btn"
                    onClick={() => handleDeleteClosure(closure.id)}
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

type ClosureFormProps = {
  salonId: string;
  closures: Closure[];
  employees: Employee[];
  onSuccess: () => Promise<void>;
  onCancel: () => void;
};

function ClosureForm({
  salonId,
  closures,
  employees,
  onSuccess,
  onCancel,
}: ClosureFormProps) {
  const {
    register,
    handleSubmit,
    control,
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

  const isFullDay = useWatch({
    control,
    name: "is_full_day",
  });

  async function onSubmit(data: ClosureFormData) {
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
      alert("Ovaj neradni period se preklapa sa postojećim periodom.");
      return;
    }

    try {
      await createClosure({
        salon_id: salonId,
        employee_id: newEmployeeId,
        title: data.title,
        reason: data.reason || null,
        starts_at: isoStart,
        ends_at: isoEnd,
        is_full_day: data.is_full_day,
        created_by: null,
      });

      reset();
      await onSuccess();
    } catch (error) {
      console.error("Greška pri kreiranju neradnog perioda:", error);
    }
  }

  return (
    <form className="closure-form" onSubmit={handleSubmit(onSubmit)}>
      <div className="form-grid-inputs">
        <div className="input-field-group">
          <label>Odnosi se na</label>

          <select {...register("employee_id")}>
            <option value="">Ceo salon</option>

            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.display_name || employee.full_name}
              </option>
            ))}
          </select>
        </div>

        <div className="input-field-group">
          <label>Naziv</label>
          <input
            {...register("title")}
            placeholder="Godišnji odmor, bolovanje, praznik..."
          />
          {errors.title && (
            <span className="error-text-span">{errors.title.message}</span>
          )}
        </div>
      </div>

      <div className="input-field-group">
        <label>Razlog / napomena</label>
        <textarea {...register("reason")} />
        {errors.reason && (
          <span className="error-text-span">{errors.reason.message}</span>
        )}
      </div>

      <label className="closure-checkbox-row">
        <input type="checkbox" {...register("is_full_day")} />
        Ceo dan
      </label>

      <div className="form-grid-inputs">
        <div className="input-field-group">
          <label>{isFullDay ? "Početni datum" : "Početak"}</label>
          <input
            type={isFullDay ? "date" : "datetime-local"}
            {...register("starts_at")}
          />
          {errors.starts_at && (
            <span className="error-text-span">
              {errors.starts_at.message}
            </span>
          )}
        </div>

        <div className="input-field-group">
          <label>{isFullDay ? "Završni datum" : "Kraj"}</label>
          <input
            type={isFullDay ? "date" : "datetime-local"}
            {...register("ends_at")}
          />
          {errors.ends_at && (
            <span className="error-text-span">{errors.ends_at.message}</span>
          )}
        </div>
      </div>

      <div className="form-actions-buttons">
        <button type="button" className="btn-cancel" onClick={onCancel}>
          Otkaži
        </button>

        <button type="submit" className="btn-save" disabled={isSubmitting}>
          {isSubmitting ? "Čuvanje..." : "Sačuvaj period"}
        </button>
      </div>
    </form>
  );
}