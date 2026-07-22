"use client";

import { useEffect, useState } from "react";
import { useSalon } from "@/context/SalonContext";
import { useAuthorization } from "@/context/AuthorizationContext";
import { getSalonAppointmentsByDate } from "@/services/appointmentQueryService";

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
  const [error, setError] = useState("");

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
