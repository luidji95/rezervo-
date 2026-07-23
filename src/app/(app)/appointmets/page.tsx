"use client";

import { useEffect, useState } from "react";
import { useSalon } from "@/context/SalonContext";
import { useAuthorization } from "@/context/AuthorizationContext";
import { getSalonAppointmentsByDate } from "@/services/appointmentQueryService";
import {
  EmployeeAppointmentError,
  type EmployeeAppointmentStatus,
  updateOwnAppointmentStatus,
} from "@/services/employeeAppointmentService";

import type { AppointmentListItem } from "@/services/appointmentQueryService";
import {
  DEFAULT_SALON_TIME_ZONE,
  getTodayDateKey,
} from "@/lib/salonDateTime";



function formatTime(value: string, timeZone: string) {
  return new Date(value).toLocaleTimeString("sr-RS", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  });
}

export default function AppointmentsPage() {
  const { currentSalon, salonLoading } = useSalon();
  const { currentRole } = useAuthorization();
  const salonTimeZone = currentSalon?.timezone || DEFAULT_SALON_TIME_ZONE;

  const [selectedDate, setSelectedDate] = useState(() =>
    getTodayDateKey(currentSalon?.timezone || DEFAULT_SALON_TIME_ZONE),
  );
  const [appointments, setAppointments] = useState<AppointmentListItem[]>([]);
  const [loadingAppointments, setLoadingAppointments] = useState(false);
  const [updatingAppointmentId, setUpdatingAppointmentId] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function handleEmployeeStatusChange(
    appointmentId: string,
    status: EmployeeAppointmentStatus,
  ) {
    if (!currentSalon || currentRole !== "employee" || updatingAppointmentId) return;

    try {
      setUpdatingAppointmentId(appointmentId);
      setError("");
      await updateOwnAppointmentStatus(appointmentId, status);
    } catch (statusError) {
      setError(
        statusError instanceof EmployeeAppointmentError &&
          (statusError.code === "INVALID_STATUS_TRANSITION" ||
            statusError.code === "APPOINTMENT_ALREADY_UPDATED")
          ? "Status termina je u međuvremenu promenjen. Lista je osvežena."
          : "Status termina trenutno nije moguće promeniti.",
      );
    } finally {
      const freshAppointments = await getSalonAppointmentsByDate(
        currentSalon.id,
        selectedDate,
        salonTimeZone,
      ).catch(() => null);
      if (freshAppointments) setAppointments(freshAppointments);
      setUpdatingAppointmentId(null);
    }
  }

  useEffect(() => {
    async function loadAppointments() {
      if (!currentSalon) return;

      try {
        setLoadingAppointments(true);
        setError("");

        const data = await getSalonAppointmentsByDate(
          currentSalon.id,
          selectedDate,
          salonTimeZone,
        );

        setAppointments(data);
      } catch (error) {
        if (error instanceof Error) {
          setError(error.message);
        } else {
          setError("Failed to load appointments.");
        }
      } finally {
        setLoadingAppointments(false);
      }
    }

    loadAppointments();
  }, [currentSalon, salonTimeZone, selectedDate]);

  if (salonLoading) {
    return <p>Loading salon...</p>;
  }

  if (!currentSalon) {
    return <p>No salon selected.</p>;
  }

  return (
    <main>
      <header>
        <h1>Appointments</h1>
        <p>Manage daily appointments for {currentSalon.name}.</p>
      </header>

      {currentRole === "employee" && (
        <p>
          Izmene termina za zaposlene biće omogućene u sledećoj fazi.
        </p>
      )}

      <section>
        <label htmlFor="appointment-date">Select date</label>
        <input
          id="appointment-date"
          type="date"
          value={selectedDate}
          onChange={(event) => setSelectedDate(event.target.value)}
        />
      </section>

      {loadingAppointments && <p>Loading appointments...</p>}

      {error && <p>{error}</p>}

      {!loadingAppointments && !error && appointments.length === 0 && (
        <p>No appointments for this date.</p>
      )}

      {!loadingAppointments && appointments.length > 0 && (
        <section>
          <h2>Daily schedule</h2>

          <ul>
            {appointments.map((appointment) => (
              <li key={appointment.id}>
                <article>
                  <h3>
                    {formatTime(appointment.start_time, salonTimeZone)} -{" "}
                    {formatTime(appointment.end_time, salonTimeZone)}
                  </h3>

                  <p>
                    Client:{" "}
                    {appointment.clients?.full_name ?? "Unknown client"}
                  </p>

                  <p>
                    Service:{" "}
                    {appointment.services?.name ?? "Unknown service"}
                  </p>

                  <p>
                    Employee:{" "}
                    {appointment.employees?.display_name ||
                      appointment.employees?.full_name ||
                      "No employee"}
                  </p>

                  <p>Status: {appointment.status}</p>

                  {currentRole === "employee" && appointment.status === "pending" && (
                    <div>
                      <button type="button" disabled={Boolean(updatingAppointmentId)} onClick={() => void handleEmployeeStatusChange(appointment.id, "confirmed")}>
                        Potvrdi
                      </button>{" "}
                      <button type="button" disabled={Boolean(updatingAppointmentId)} onClick={() => void handleEmployeeStatusChange(appointment.id, "cancelled")}>
                        Otkaži
                      </button>
                    </div>
                  )}

                  {currentRole === "employee" && appointment.status === "confirmed" && (
                    <div>
                      <button type="button" disabled={Boolean(updatingAppointmentId)} onClick={() => void handleEmployeeStatusChange(appointment.id, "completed")}>
                        Završi
                      </button>{" "}
                      <button type="button" disabled={Boolean(updatingAppointmentId)} onClick={() => void handleEmployeeStatusChange(appointment.id, "no_show")}>
                        Nije došao
                      </button>{" "}
                      <button type="button" disabled={Boolean(updatingAppointmentId)} onClick={() => void handleEmployeeStatusChange(appointment.id, "cancelled")}>
                        Otkaži
                      </button>
                    </div>
                  )}

                  <p>
                    Price: {appointment.price} {appointment.currency}
                  </p>
                </article>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
