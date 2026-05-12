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
  salonSlug: string;
  services: Service[];
  employees: Employee[];
};

export function PublicBookingTester({
  salonId,
  salonSlug,
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

  const [bookingForm, setBookingForm] = useState({
    fullName: "",
    phone: "",
    email: "",
  });

  const [bookingLoading, setBookingLoading] = useState(false);

  // Dodat state za uspeh rezervacije
  const [bookingSuccess, setBookingSuccess] = useState<{
    startTime: string;
    endTime: string;
    customerName: string;
  } | null>(null);

  const updateBookingForm = (
    key: "fullName" | "phone" | "email",
    value: string
  ) => {
    setBookingForm((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const handleCreateBooking = async () => {
    if (!selectedServiceId || !selectedEmployeeId || !selectedSlot) {
      alert("Please select service, employee and slot.");
      return;
    }

    if (!bookingForm.fullName.trim()) {
      alert("Full name is required.");
      return;
    }

    try {
      setBookingLoading(true);

      const response = await fetch("/api/public-booking/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          salonSlug: salonSlug,
          serviceId: selectedServiceId,
          employeeId: selectedEmployeeId,
          startTime: selectedSlot.startTime,
          customer: {
            fullName: bookingForm.fullName,
            phone: bookingForm.phone,
            email: bookingForm.email,
          },
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        alert(data.error || "Booking failed.");
        return;
      }

      // Postavljanje podataka za uspeh pre nego što resetujemo formu
      setBookingSuccess({
        startTime: selectedSlot.startTime,
        endTime: selectedSlot.endTime,
        customerName: bookingForm.fullName,
      });

      setSlots((prevSlots) =>
        prevSlots.filter((slot) => slot.startTime !== selectedSlot.startTime)
      );

      setSelectedSlot(null);

      setBookingForm({
        fullName: "",
        phone: "",
        email: "",
      });

      setMessage("Booking created successfully.");
    } catch (error) {
      console.error(error);
      alert("Something went wrong.");
    } finally {
      setBookingLoading(false);
    }
  };

  async function handleFetchSlots() {
    try {
      setLoading(true);
      setMessage("");
      setSlots([]);
      setSelectedSlot(null);
      setBookingSuccess(null); // Resetujemo uspeh pri novoj pretrazi

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

      {/* Selectors */}
      <div>
        <label>Service</label>
        <select
          value={selectedServiceId}
          onChange={(e) => {
            setSelectedServiceId(e.target.value);
            setSlots([]);
            setSelectedSlot(null);
            setMessage("");
            setBookingSuccess(null);
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
            setBookingSuccess(null);
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
            setBookingSuccess(null);
          }}
        />
      </div>

      <button type="button" onClick={handleFetchSlots} disabled={loading}>
        {loading ? "Loading..." : "Get available slots"}
      </button>

      {message && <p>{message}</p>}

      {/* Slots Grid */}
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

      {/* Form */}
      <div>
        <h3>Customer Details</h3>
        <input
          type="text"
          placeholder="Full name"
          value={bookingForm.fullName}
          onChange={(e) => updateBookingForm("fullName", e.target.value)}
        />
        <input
          type="text"
          placeholder="Phone"
          value={bookingForm.phone}
          onChange={(e) => updateBookingForm("phone", e.target.value)}
        />
        <input
          type="email"
          placeholder="Email"
          value={bookingForm.email}
          onChange={(e) => updateBookingForm("email", e.target.value)}
        />

        <button onClick={handleCreateBooking} disabled={bookingLoading}>
          {bookingLoading ? "Creating..." : "Create Booking"}
        </button>
      </div>

      {/* Success View */}
      {bookingSuccess && (
        <div style={{ marginTop: "20px", padding: "15px", border: "1px solid green", borderRadius: "8px" }}>
          <h3>Booking confirmed</h3>
          <p>
            {bookingSuccess.customerName}, your appointment is booked for{" "}
            {formatSlotTime(bookingSuccess.startTime)} -{" "}
            {formatSlotTime(bookingSuccess.endTime)}.
          </p>
        </div>
      )}
    </section>
  );
}