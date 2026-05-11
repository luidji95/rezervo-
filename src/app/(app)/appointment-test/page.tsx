"use client";

import { useState } from "react";
import { createAppointment } from "@/services/appointmentService";
import { useSalon } from "@/context/SalonContext";

export default function AppointmentTestPage() {
  const { currentSalon, salonLoading } = useSalon();

  const [serviceId, setServiceId] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [startTime, setStartTime] = useState("");

  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [clientEmail, setClientEmail] = useState("");

  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleCreateAppointment(e: React.FormEvent) {
    e.preventDefault();

    if (!currentSalon) {
      setMessage("No salon selected.");
      return;
    }

    try {
      setIsSubmitting(true);
      setMessage("");

      const appointment = await createAppointment({
        salonId: currentSalon.id,
        serviceId,
        employeeId,
        startTime: new Date(startTime).toISOString(),
        client: {
          fullName: clientName,
          phone: clientPhone || undefined,
          email: clientEmail || undefined,
        },
        bookingSource: "manual",
      });

      setMessage(`Appointment created successfully: ${appointment.id}`);
    } catch (error) {
      if (error instanceof Error) {
        setMessage(error.message);
      } else {
        setMessage("Something went wrong.");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  if (salonLoading) {
    return <p>Loading salon...</p>;
  }

  if (!currentSalon) {
    return <p>No salon found.</p>;
  }

  return (
    <main>
      <h1>Appointment Test</h1>

      <p>
        This page is only for testing the appointment engine before connecting
        it to the public booking UI.
      </p>

      <form onSubmit={handleCreateAppointment}>
        <div>
          <label>Service ID</label>
          <input
            value={serviceId}
            onChange={(e) => setServiceId(e.target.value)}
            placeholder="Paste service id"
          />
        </div>

        <div>
          <label>Employee ID</label>
          <input
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            placeholder="Paste employee id"
          />
        </div>

        <div>
          <label>Start time</label>
          <input
            type="datetime-local"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
          />
        </div>

        <div>
          <label>Client full name</label>
          <input
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
            placeholder="Petar Petrovic"
          />
        </div>

        <div>
          <label>Client phone</label>
          <input
            value={clientPhone}
            onChange={(e) => setClientPhone(e.target.value)}
            placeholder="+381..."
          />
        </div>

        <div>
          <label>Client email</label>
          <input
            value={clientEmail}
            onChange={(e) => setClientEmail(e.target.value)}
            placeholder="client@email.com"
          />
        </div>

        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Creating..." : "Create appointment"}
        </button>
      </form>

      {message && <p>{message}</p>}
    </main>
  );
}