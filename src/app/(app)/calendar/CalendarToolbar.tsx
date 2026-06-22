"use client";

import { ChevronLeft, CalendarDays, ChevronRight, Plus } from "lucide-react";

type CalendarToolbarProps = {
  selectedDate: string;
  onDateChange: (date: string) => void;
  onPreviousDay: () => void;
  onNextDay: () => void;
  onToday: () => void;
  onCreateClick: () => void; // <-- DODATO: Novi prop za otvaranje Create modala
};

export default function CalendarToolbar({
  selectedDate,
  onDateChange,
  onPreviousDay,
  onNextDay,
  onToday,
  onCreateClick, // <-- Destrukturiran novi prop
}: CalendarToolbarProps) {
  return (
    <section className="calendar-toolbar">
      {/* LEVA STRANA: Navigacija kroz vreme */}
      <div className="calendar-toolbar__left">
        <button
          type="button"
          className="btn-today"
          onClick={onToday}
        >
          Danas
        </button>

        <div className="date-navigator">
          <button 
            type="button" 
            className="btn-nav-arrow"
            onClick={onPreviousDay}
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
              />
            </div>
          </div>

          <button 
            type="button" 
            className="btn-nav-arrow"
            onClick={onNextDay}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {/* DESNA STRANA: Primarna akcija */}
      <div className="calendar-toolbar__right">
        {/* GLAVNA AKCIJA: Povezana na klik menadžera */}
        <button 
          type="button" 
          className="topbar-new-appointment-btn"
          onClick={onCreateClick} // <-- Aktivirana akcija na klik
        >
          <Plus size={16} />
          <span>Novi termin</span>
        </button>
      </div>
    </section>
  );
}
