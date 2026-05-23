"use client";

import { useState } from "react";
import { X } from "lucide-react";
import type { CalendarAppointment } from "@/services/calendarQueryService";
import type { CalendarEmployee } from "@/services/employeeQueryService";

type RescheduleAppointmentModalProps = {
  isOpen: boolean;
  onClose: () => void;
  appointment: CalendarAppointment;
  employees: CalendarEmployee[];
  onRescheduleConfirm: (
    appointmentId: string,
    newStart: string,
    newEnd: string,
    newEmployeeId: string
  ) => Promise<void>;
};

// Generiše fiksne vremenske slotove od 08:00 do 20:00 (Privremeno rešenje do pravog Availability Engine-a)
function generateMockSlots() {
  const slots = [];
  for (let hour = 8; hour < 20; hour++) {
    const formattedHour = hour.toString().padStart(2, "0");
    slots.push(`${formattedHour}:00`);
    slots.push(`${formattedHour}:30`);
  }
  return slots;
}

export default function RescheduleAppointmentModal({
  isOpen,
  onClose,
  appointment,
  employees,
  onRescheduleConfirm,
}: RescheduleAppointmentModalProps) {
  // Izvlačenje čistog YYYY-MM-DD formata iz start_time-a
  const initialDate = appointment.start_time.slice(0, 10);
  const initialEmployeeId = appointment.employees?.id || "";

  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(initialEmployeeId);
  const [selectedTimeSlot, setSelectedTimeSlot] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen) return null;

  // Izračunavanje trajanja originalnog termina u milisekundama
  const durationMs =
    new Date(appointment.end_time).getTime() - new Date(appointment.start_time).getTime();

  // Handleri koji menjaju vrednost i istovremeno bezbedno prazne slot BEZ useEffect-a
  const handleDateChange = (newDate: string) => {
    setSelectedDate(newDate);
    setSelectedTimeSlot(null); // Čist eksplicitan reset
  };

  const handleEmployeeChange = (newEmpId: string) => {
    setSelectedEmployeeId(newEmpId);
    setSelectedTimeSlot(null); // Čist eksplicitan reset
  };

  const handleSave = async () => {
    if (!selectedTimeSlot) return;

    try {
      setSubmitting(true);

      // Sklapanje novog ISO stringa za start i end time
      const newStartISO = new Date(`${selectedDate}T${selectedTimeSlot}:00`).toISOString();
      const newEndISO = new Date(new Date(newStartISO).getTime() + durationMs).toISOString();

      await onRescheduleConfirm(appointment.id, newStartISO, newEndISO, selectedEmployeeId);
      onClose();
    } catch (err) {
      console.error("Greška pri pomeranju termina:", err);
      alert("Nije uspelo pomeranje termina.");
    } finally {
      setSubmitting(false);
    }
  };

  const timeSlots = generateMockSlots();

  return (
    <div className="modal-backdrop" style={{
      position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: "rgba(15, 23, 42, 0.6)", display: "flex",
      alignItems: "center", justifyContent: "center", zIndex: 1000,
      backdropFilter: "blur(4px)"
    }}>
      <div className="modal-card" style={{
        backgroundColor: "#ffffff", borderRadius: "12px", width: "100%",
        maxWidth: "480px", padding: "24px", boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1)"
      }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
          <div>
            <h2 style={{ fontSize: "18px", fontWeight: 600, color: "#0f172a" }}>Pomeri termin</h2>
            <p style={{ fontSize: "13px", color: "#64748b", marginTop: "2px" }}>
              Klijent: <strong>{appointment.clients?.full_name}</strong>
            </p>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#64748b", marginLeft: "auto" }}>
            <X size={20} />
          </button>
        </div>

        {/* Form Fields */}
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          
          {/* Izbor datuma */}
          <div>
            <label style={{ display: "block", fontSize: "13px", fontWeight: 500, color: "#334155", marginBottom: "6px" }}>
              Novi datum
            </label>
            <div>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => handleDateChange(e.target.value)} // <-- Izmenjeno
                style={{
                  width: "100%", padding: "10px 12px", borderRadius: "6px",
                  border: "1px solid #cbd5e1", fontSize: "14px", outline: "none"
                }}
              />
            </div>
          </div>

          {/* Izbor zaposlenog */}
          <div>
            <label style={{ display: "block", fontSize: "13px", fontWeight: 500, color: "#334155", marginBottom: "6px" }}>
              Zaposleni
            </label>
            <select
              value={selectedEmployeeId}
              onChange={(e) => handleEmployeeChange(e.target.value)} // <-- Izmenjeno
              style={{
                width: "100%", padding: "10px 12px", borderRadius: "6px",
                border: "1px solid #cbd5e1", fontSize: "14px", backgroundColor: "#fff", outline: "none"
              }}
            >
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.display_name || emp.full_name}
                </option>
              ))}
            </select>
          </div>

          {/* Slobodni Slotovi */}
          <div>
            <label style={{ display: "block", fontSize: "13px", fontWeight: 500, color: "#334155", marginBottom: "8px" }}>
              Dostupni termini (Trajanje: {Math.round(durationMs / 1000 / 60)} min)
            </label>
            
            <div style={{
              display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px",
              maxHeight: "180px", overflowY: "auto", padding: "4px", border: "1px solid #f1f5f9", borderRadius: "6px"
            }}>
              {timeSlots.map((slot) => {
                const isSelected = selectedTimeSlot === slot;
                return (
                  <button
                    key={slot}
                    type="button"
                    onClick={() => setSelectedTimeSlot(slot)}
                    style={{
                      padding: "8px 4px", borderRadius: "6px", fontSize: "13px", fontWeight: 500,
                      border: isSelected ? "1px solid #4f46e5" : "1px solid #e2e8f0",
                      backgroundColor: isSelected ? "#e0e7ff" : "#ffffff",
                      color: isSelected ? "#4f46e5" : "#334155",
                      cursor: "pointer", transition: "all 0.15s"
                    }}
                  >
                    {slot}
                  </button>
                );
              })}
            </div>
          </div>

        </div>

        {/* Footer Actions */}
        <div style={{ display: "flex", gap: "12px", justifyContent: "end", marginTop: "24px" }}>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            style={{
              padding: "10px 16px", borderRadius: "6px", border: "1px solid #cbd5e1",
              backgroundColor: "#ffffff", color: "#334155", fontSize: "14px", cursor: "pointer"
            }}
          >
            Otkaži
          </button>
          
          <button
            type="button"
            onClick={handleSave}
            disabled={submitting || !selectedTimeSlot}
            style={{
              padding: "10px 16px", borderRadius: "6px", border: "none",
              backgroundColor: !selectedTimeSlot ? "#94a3b8" : "#4f46e5",
              color: "#ffffff", fontSize: "14px", fontWeight: 500,
              cursor: !selectedTimeSlot ? "not-allowed" : "pointer"
            }}
          >
            {submitting ? "Čuvanje..." : "Potvrdi pomeranje"}
          </button>
        </div>

      </div>
    </div>
  );
}