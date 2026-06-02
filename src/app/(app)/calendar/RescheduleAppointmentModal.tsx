"use client";

import { useState, useEffect } from "react";
import { X } from "lucide-react";
import type { CalendarAppointment } from "@/services/calendarQueryService";
import type { CalendarEmployee } from "@/services/employeeQueryService";
import { generateAvailableSlots } from "@/services/availabilityService";

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

export default function RescheduleAppointmentModal({
  isOpen,
  onClose,
  appointment,
  employees,
  onRescheduleConfirm,
}: RescheduleAppointmentModalProps) {
  const initialDate = appointment.start_time.slice(0, 10);
  const initialEmployeeId = appointment.employees?.id || "";

  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(initialEmployeeId);
  
  const [availableSlots, setAvailableSlots] = useState<Array<{ startTime: string; endTime: string }>>([]);
  const [selectedSlotIndex, setSelectedSlotIndex] = useState<number | null>(null);
  
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    async function fetchRealSlots() {
      // Sada bezbedno vučemo podatke jer tipovi u potpunosti postoje na CalendarAppointment objektu
      const salonId = appointment.salon_id;
      const serviceId = appointment.services?.id;

      if (!salonId || !serviceId) {
        console.error("Nedostaju salonId ili serviceId podaci na appointment objektu:", appointment);
        return;
      }

      try {
        setLoadingSlots(true);
        setSelectedSlotIndex(null); // Resetujemo selekciju pre svakog novog kalkulisanja

        const result = await generateAvailableSlots({
          salonId,
          serviceId,
          employeeId: selectedEmployeeId,
          date: selectedDate,
          excludeAppointmentId: appointment.id, // Ignorišemo trenutni termin iz provere konflikata
        });

        setAvailableSlots(result.slots || []);
      } catch (err) {
        console.error("Greška pri dobavljanju slobodnih slotova:", err);
      } finally {
        setLoadingSlots(false);
      }
    }

    fetchRealSlots();
  }, [selectedDate, selectedEmployeeId, isOpen, appointment]);

  if (!isOpen) return null;

  const durationMs =
    new Date(appointment.end_time).getTime() - new Date(appointment.start_time).getTime();

  const handleSave = async () => {
    if (selectedSlotIndex === null) return;

    const chosenSlot = availableSlots[selectedSlotIndex];

    try {
      setSubmitting(true);
      await onRescheduleConfirm(
        appointment.id,
        chosenSlot.startTime,
        chosenSlot.endTime,
        selectedEmployeeId
      );
      onClose();
    } catch (err) {
      console.error("Greška pri pomeranju termina:", err);
      alert("Nije uspelo pomeranje termina.");
    } finally {
      setSubmitting(false);
    }
  };

  const formatSlotTime = (isoString: string) => {
    return new Date(isoString).toLocaleTimeString("sr-RS", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Belgrade",
    });
  };

  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: "rgba(15, 23, 42, 0.6)", display: "flex",
      alignItems: "center", justifyContent: "center", zIndex: 1000,
      backdropFilter: "blur(4px)"
    }}>
      <div style={{
        backgroundColor: "#ffffff", borderRadius: "12px", width: "100%",
        maxWidth: "480px", padding: "24px", boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1)"
      }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
          <div>
            <h2 style={{ fontSize: "18px", fontWeight: 600, color: "#0f172a" }}>Pomeri termin</h2>
            <p style={{ fontSize: "13px", color: "#64748b", marginTop: "2px" }}>
              Klijent: <strong>{appointment.clients?.full_name || "Nepoznat klijent"}</strong>
            </p>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#64748b" }}>
            <X size={20} />
          </button>
        </div>

        {/* Form */}
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div>
            <label style={{ display: "block", fontSize: "13px", fontWeight: 500, color: "#334155", marginBottom: "6px" }}>
              Novi datum
            </label>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              style={{
                width: "100%", padding: "10px 12px", borderRadius: "6px",
                border: "1px solid #cbd5e1", fontSize: "14px", outline: "none",
                color: "#0f172a"
              }}
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: "13px", fontWeight: 500, color: "#334155", marginBottom: "6px" }}>
              Zaposleni
            </label>
            <select
              value={selectedEmployeeId}
              onChange={(e) => setSelectedEmployeeId(e.target.value)}
              style={{
                width: "100%", padding: "10px 12px", borderRadius: "6px",
                border: "1px solid #cbd5e1", fontSize: "14px", backgroundColor: "#fff", outline: "none",
                color: "#0f172a"
              }}
            >
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.display_name || emp.full_name}
                </option>
              ))}
            </select>
          </div>

          {/* Slotovi izbačeni kroz tvoj pravi Availability Engine */}
          <div>
            <label style={{ display: "block", fontSize: "13px", fontWeight: 500, color: "#334155", marginBottom: "8px" }}>
              Slobodni termini (Trajanje: {Math.round(durationMs / 1000 / 60)} min)
            </label>
            
            {loadingSlots ? (
              <p style={{ fontSize: "13px", color: "#64748b", padding: "12px 0" }}>Računam slobodne termine...</p>
            ) : availableSlots.length === 0 ? (
              <p style={{ fontSize: "13px", color: "#ef4444", padding: "12px 0" }}>Nema slobodnih termina za izabrane parametre.</p>
            ) : (
              <div style={{
                display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px",
                maxHeight: "180px", overflowY: "auto", padding: "4px", border: "1px solid #f1f5f9", borderRadius: "6px"
              }}>
                {availableSlots.map((slot, index) => {
                  const isSelected = selectedSlotIndex === index;
                  return (
                    <button
                      key={slot.startTime}
                      type="button"
                      onClick={() => setSelectedSlotIndex(index)}
                      style={{
                        padding: "8px 4px", borderRadius: "6px", fontSize: "13px", fontWeight: 500,
                        border: isSelected ? "1px solid #4f46e5" : "1px solid #e2e8f0",
                        backgroundColor: isSelected ? "#e0e7ff" : "#ffffff",
                        color: isSelected ? "#4f46e5" : "#334155",
                        cursor: "pointer", transition: "all 0.15s"
                      }}
                    >
                      {formatSlotTime(slot.startTime)}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
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
            disabled={submitting || selectedSlotIndex === null}
            style={{
              padding: "10px 16px", borderRadius: "6px", border: "none",
              backgroundColor: selectedSlotIndex === null ? "#94a3b8" : "#4f46e5",
              color: "#ffffff", fontSize: "14px", fontWeight: 500,
              cursor: selectedSlotIndex === null ? "not-allowed" : "pointer"
            }}
          >
            {submitting ? "Čuvanje..." : "Potvrdi pomeranje"}
          </button>
        </div>
      </div>
    </div>
  );
}