"use client";

import { useState } from "react";
import { generateAvailableSlots } from "@/services/availabilityService";
import type { AvailableSlot } from "@/types/availability";

export default function AvailabilityTestPage() {
  const [slots, setSlots] = useState<AvailableSlot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleTestAvailability() {
    setLoading(true);
    setError("");
    setSlots([]);

    try {
      const result = await generateAvailableSlots({
        salonId: "a58d29c4-006e-4ff2-9f8a-61231d527379",
        serviceId: "1ffac6a2-5ebb-4044-b091-b982037eaf88",
        employeeId: "541c9491-6bee-4101-99a2-0f62ad7fd4a8",
        date: "2026-05-12",
      });

      setSlots(result.slots);
    } catch (err) {
      console.error(err);
      setError("Failed to generate available slots.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ padding: "32px" }}>
      <h1>Availability Test</h1>

      <button onClick={handleTestAvailability} disabled={loading}>
        {loading ? "Testing..." : "Generate slots"}
      </button>

      {error && <p style={{ color: "red" }}>{error}</p>}

      <div style={{ marginTop: "24px" }}>
        <h2>Available Slots</h2>

        {slots.length === 0 && !loading && <p>No slots generated yet.</p>}

        <ul>
          {slots.map((slot) => (
            <li key={`${slot.employeeId}-${slot.startTime}`}>
              {new Date(slot.startTime).toLocaleTimeString("sr-RS", {
                hour: "2-digit",
                minute: "2-digit",
              })}{" "}
              -{" "}
              {new Date(slot.endTime).toLocaleTimeString("sr-RS", {
                hour: "2-digit",
                minute: "2-digit",
              })}{" "}
              | Employee: {slot.employeeId}
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}