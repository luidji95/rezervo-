"use client";

import { useState } from "react";

type Service = {
  id: string;
  name: string;
  duration_minutes: number;
  price: number;
  currency: string;
};

type Employee = {
  id: string;
  full_name: string;
  display_name: string | null;
  position: string | null;
};

type Slot = {
  startTime: string;
  endTime: string;
  employeeId: string;
};

type PublicBookingTesterProps = {
  salonId: string;
  services: Service[];
  employees: Employee[];
};

export function PublicBookingTester({
  salonId,
  services,
  employees,
}: PublicBookingTesterProps) {
  const [selectedServiceId, setSelectedServiceId] = useState(
    services[0]?.id ?? ""
  );
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(
    employees[0]?.id ?? ""
  );
  const [selectedDate, setSelectedDate] = useState("2026-05-12");

  const [slots, setSlots] = useState<Slot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);

  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleFetchSlots() {
    try {
      setLoading(true);
      setMessage("");
      setSlots([]);
      setSelectedSlot(null);

      if (!selectedServiceId || !selectedEmployeeId || !selectedDate) {
        setMessage("Please select service, employee and date.");
        return;
      }

      const response = await fetch("/api/public-booking/availability", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          salonId,
          serviceId: selectedServiceId,
          employeeId: selectedEmployeeId,
          date: selectedDate,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to fetch available slots.");
      }

      setSlots(data.slots);
      setMessage(`Found ${data.slots.length} available slots.`);
    } catch (error) {
      setSlots([]);
      setSelectedSlot(null);

      if (error instanceof Error) {
        setMessage(error.message);
      } else {
        setMessage("Something went wrong.");
      }
    } finally {
      setLoading(false);
    }
  }

  function formatSlotTime(dateValue: string) {
    return new Date(dateValue).toLocaleTimeString("sr-RS", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  return (
    <section>
      <h2>Public Booking Tester</h2>

      <div>
        <label>Service</label>
        <select
          value={selectedServiceId}
          onChange={(e) => {
            setSelectedServiceId(e.target.value);
            setSlots([]);
            setSelectedSlot(null);
            setMessage("");
          }}
        >
          {services.map((service) => (
            <option key={service.id} value={service.id}>
              {service.name} — {service.duration_minutes} min — {service.price}{" "}
              {service.currency}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label>Employee</label>
        <select
          value={selectedEmployeeId}
          onChange={(e) => {
            setSelectedEmployeeId(e.target.value);
            setSlots([]);
            setSelectedSlot(null);
            setMessage("");
          }}
        >
          {employees.map((employee) => (
            <option key={employee.id} value={employee.id}>
              {employee.display_name || employee.full_name}
              {employee.position ? ` — ${employee.position}` : ""}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label>Date</label>
        <input
          type="date"
          value={selectedDate}
          onChange={(e) => {
            setSelectedDate(e.target.value);
            setSlots([]);
            setSelectedSlot(null);
            setMessage("");
          }}
        />
      </div>

      <button type="button" onClick={handleFetchSlots} disabled={loading}>
        {loading ? "Loading..." : "Get available slots"}
      </button>

      {message && <p>{message}</p>}

      {slots.length > 0 && (
        <div>
          <h3>Choose a time</h3>

          <div>
            {slots.map((slot) => {
              const isSelected = selectedSlot?.startTime === slot.startTime;

              return (
                <button
                  key={slot.startTime}
                  type="button"
                  onClick={() => setSelectedSlot(slot)}
                  style={{
                    margin: "4px",
                    padding: "8px 12px",
                    border: isSelected ? "2px solid black" : "1px solid #ccc",
                    background: isSelected ? "#e7e7e7" : "white",
                    cursor: "pointer",
                  }}
                >
                  {formatSlotTime(slot.startTime)} -{" "}
                  {formatSlotTime(slot.endTime)}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {selectedSlot && (
        <div>
          <h3>Selected slot</h3>
          <p>
            {formatSlotTime(selectedSlot.startTime)} -{" "}
            {formatSlotTime(selectedSlot.endTime)}
          </p>
        </div>
      )}
    </section>
  );
}