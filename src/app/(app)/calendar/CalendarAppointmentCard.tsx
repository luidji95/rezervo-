"use client";

import type { CalendarAppointment } from "@/services/calendarQueryService";
import { isInactiveCalendarStatus, type CalendarLane } from "@/features/calendar/calendarAppointmentLayout";

type CalendarAppointmentCardProps = {
  appointment: CalendarAppointment;
  top: number;
  height: number;
  isSelected: boolean;
  // Lane among overlapping cards of the same employee (e.g. a cancelled appointment and the new booking of its slot).
  lane?: CalendarLane;
  onSelect: (appointment: CalendarAppointment) => void;
};

// 1. ČISTI HELPER ZA CSS KLASE (Samo stabilne engleske vrednosti iz baze)
function getAppointmentStatusClass(status: string) {
  const normalizedStatus = status?.toLowerCase().trim();

  switch (normalizedStatus) {
    case "confirmed":
      return "calendar-appointment-card--confirmed";
    case "completed":
      return "calendar-appointment-card--completed";
    case "cancelled":
      return "calendar-appointment-card--cancelled";
    case "pending":
      return "calendar-appointment-card--pending";
    case "no_show":
      return "calendar-appointment-card--no-show";
    default:
      return "calendar-appointment-card--default";
  }
}

// 2. HELPER ZA UI PRIKAZ (Prevod na srpski jezik u lejeru prezentacije)
function getAppointmentStatusLabel(status: string) {
  const normalizedStatus = status?.toLowerCase().trim();

  switch (normalizedStatus) {
    case "confirmed":
      return "Potvrđeno";
    case "completed":
      return "Završeno";
    case "cancelled":
      return "Otkazano";
    case "pending":
      return "Na čekanju";
    case "no_show":
      return "Nije došao";
    default:
      return status; // Ako se pojavi nešto nepoznato, ispiši sirovu vrednost
  }
}

export default function CalendarAppointmentCard({
  appointment,
  top,
  height,
  isSelected,
  lane,
  onSelect,
}: CalendarAppointmentCardProps) {
  
  const statusClass = getAppointmentStatusClass(appointment.status);
  const isSelectedClass = isSelected ? "calendar-appointment-card--selected" : "";
  const layerClass = isInactiveCalendarStatus(appointment.status) ? "calendar-appointment-card--inactive" : "calendar-appointment-card--active";
  const laneStyle = lane && lane.lanes > 1
    ? { left: `calc(10px + (100% - 20px) * ${lane.lane} / ${lane.lanes})`, right: "auto", width: `calc((100% - 20px) / ${lane.lanes} - 4px)` }
    : {};
  
  return (
    <button
      type="button"
      className={`calendar-appointment-card ${statusClass} ${layerClass} ${isSelectedClass}`}
      style={{ top: `${top}px`, height: `${height}px`, ...laneStyle }}
      onClick={() => onSelect(appointment)}
      aria-label={`${getAppointmentStatusLabel(appointment.status)} termin za ${appointment.clients?.full_name ?? "klijenta"}`}
    >
      {/* Vreme trajanja termina */}
      <div className="calendar-appointment-time">
        {new Date(appointment.start_time).toLocaleTimeString("sr-RS", {
          hour: "2-digit",
          minute: "2-digit",
        })}
        {" - "}
        {new Date(appointment.end_time).toLocaleTimeString("sr-RS", {
          hour: "2-digit",
          minute: "2-digit",
        })}
      </div>

      {/* Detalji o klijentu i usluzi */}
      <div className="calendar-appointment-details">
        <span className="calendar-appointment-client">
          {appointment.clients?.full_name ?? "Klijent"}
        </span>
        <span className="calendar-appointment-service">
          • {appointment.services?.name ?? "Usluga"}
        </span>
      </div>

      <span className="calendar-appointment-status">
        {getAppointmentStatusLabel(appointment.status)}
      </span>
    </button>
  );
}
