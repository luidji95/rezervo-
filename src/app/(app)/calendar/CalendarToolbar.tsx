"use client";

import { ChevronLeft, CalendarDays, ChevronRight, Plus } from "lucide-react";

type CalendarToolbarProps = {
  selectedDate: string;
  onDateChange: (date: string) => void;
  onPreviousDay: () => void;
  onNextDay: () => void;
  onToday: () => void;
  onCreateClick: () => void;
  canCreateAppointment?: boolean;
};

export default function CalendarToolbar({
  selectedDate,
  onDateChange,
  onPreviousDay,
  onNextDay,
  onToday,
  onCreateClick,
  canCreateAppointment = true,
}: CalendarToolbarProps) {
  return (
    <section className="calendar-toolbar">
      <div className="calendar-toolbar__title">
        <h1>Kalendar</h1>
        <p>Pregled dnevnog rasporeda</p>
      </div>
      {/* LEVA STRANA: Navigacija kroz vreme */}
      <div className="calendar-toolbar__left">
        <button
          type="button"
          className="btn-today"
          onClick={onToday}
          aria-label="Prikaži današnji datum"
        >
          Danas
        </button>

        <div className="date-navigator">
          <button 
            type="button" 
            className="btn-nav-arrow"
            onClick={onPreviousDay}
            aria-label="Prethodni dan"
          >
            <ChevronLeft size={16} />
          </button>
          
          <div className="date-display-wrapper">
            <span className="current-date-text">
              {new Date(selectedDate).toLocaleDateString("sr-RS", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </span>
            <div className="date-input-overlay">
              <CalendarDays size={16} className="calendar-picker-icon" />
              <input
                type="date"
                value={selectedDate}
                onChange={(event) => onDateChange(event.target.value)}
                aria-label="Izaberi datum"
              />
            </div>
          </div>

          <button 
            type="button" 
            className="btn-nav-arrow"
            onClick={onNextDay}
            aria-label="Sledeći dan"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {/* DESNA STRANA: Primarna akcija */}
      {canCreateAppointment && <div className="calendar-toolbar__right">
        {/* GLAVNA AKCIJA: Povezana na klik menadžera */}
        <button 
          type="button" 
          className="topbar-new-appointment-btn"
          onClick={onCreateClick} // <-- Aktivirana akcija na klik
          aria-label="Kreiraj novi termin"
        >
          <Plus size={16} />
          <span>Novi termin</span>
        </button>
      </div>}
    </section>
  );
}
