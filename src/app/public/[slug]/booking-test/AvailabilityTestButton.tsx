"use client";

import { useState } from "react";

type Slot = {
  startTime: string;
  endTime: string;
  employeeId: string;
};

type AvailabilityTestButtonProps = {
  salonId: string;
  employeeId: string;
  serviceId: string;
};

export function AvailabilityTestButton({
  salonId,
  employeeId,
  serviceId,
}: AvailabilityTestButtonProps) {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function handleTestAvailability() {
    try {
      setLoading(true);
      setMessage("");

      const response = await fetch("/api/public-booking/availability", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          salonId,
          employeeId,
          serviceId,
          date: "2026-05-12",
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to fetch slots.");
      }

      setSlots(data.slots);
      setMessage(`Found ${data.slots.length} available slots.`);
    } catch (error) {
      setSlots([]);

      if (error instanceof Error) {
        setMessage(error.message);
      } else {
        setMessage("Something went wrong.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <section>
      <h2>Available Slots Test</h2>

      <button onClick={handleTestAvailability} disabled={loading}>
        {loading ? "Loading slots..." : "Test Available Slots"}
      </button>

      {message && <p>{message}</p>}

      {slots.length > 0 && (
        <ul>
          {slots.map((slot) => (
            <li key={slot.startTime}>
              {new Date(slot.startTime).toLocaleTimeString("sr-RS", {
                hour: "2-digit",
                minute: "2-digit",
              })}{" "}
              -{" "}
              {new Date(slot.endTime).toLocaleTimeString("sr-RS", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}