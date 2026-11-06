"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import {
  addDaysToDateKey, formatMonthYear, formatTime, getDayParts, getDayWindow, groupSlotsByDayPart,
} from "../publicBookingFormat";
import type { PublicAvailabilitySlot, PublicEmployee, PublicEmployeeSelection, PublicService } from "../types";

const WINDOW_DAYS = 7;

type Props = {
  service: PublicService;
  today: string;
  timeZone: string;
  employees: PublicEmployee[];
  employeesLoading: boolean;
  employeesError: boolean;
  selectedEmployeeId: PublicEmployeeSelection;
  selectedDate: string;
  slots: PublicAvailabilitySlot[];
  slotsLoading: boolean;
  slotsError: boolean;
  selectedSlot: PublicAvailabilitySlot | null;
  bookingError: string | null;
  onChangeService: () => void;
  onSelectEmployee: (employeeId: string) => void;
  onSelectDate: (date: string) => void;
  onSelectSlot: (slot: PublicAvailabilitySlot) => void;
  onRetryEmployees: () => void;
  onRetrySlots: () => void;
};

function SlotGroup({ label, slots, selectedSlot, timeZone, onSelectSlot }: { label: string; slots: PublicAvailabilitySlot[]; selectedSlot: PublicAvailabilitySlot | null; timeZone: string; onSelectSlot: (slot: PublicAvailabilitySlot) => void }) {
  if (slots.length === 0) return null;
  return (
    <div className="pb-slot-group">
      <h3 className="pb-overline">{label}</h3>
      <div className="pb-slots" role="radiogroup" aria-label={label}>
        {slots.map((slot) => {
          const selected = selectedSlot?.startTime === slot.startTime && selectedSlot.employeeId === slot.employeeId;
          return (
            <button type="button" role="radio" aria-checked={selected} key={`${slot.employeeId}:${slot.startTime}`} className={`pb-slot${selected ? " is-selected" : ""}`} onClick={() => onSelectSlot(slot)}>
              {formatTime(slot.startTime, timeZone)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function PublicTimeStep(props: Props) {
  const { service, today, timeZone, employees, selectedEmployeeId, selectedDate } = props;
  // Start at today; only jump ahead when the kept date lies beyond the first window.
  const [windowStart, setWindowStart] = useState(() => (selectedDate && selectedDate >= addDaysToDateKey(today, WINDOW_DAYS) ? selectedDate : today));
  const days = getDayWindow(windowStart, WINDOW_DAYS);
  const employee = employees.find((item) => item.id === selectedEmployeeId);
  const { morning, afternoon } = groupSlotsByDayPart(props.slots, timeZone);
  const moveWindow = (direction: -1 | 1) => {
    const next = addDaysToDateKey(windowStart, direction * WINDOW_DAYS);
    setWindowStart(next < today ? today : next);
  };

  return (
    <section className="pb-step" aria-labelledby="pb-time-title">
      <h1 className="pb-title" id="pb-time-title">Izaberite termin</h1>
      <div className="pb-picked">
        <span><strong>{service.name}</strong> · {service.durationMinutes} min</span>
        <button type="button" className="pb-link" onClick={props.onChangeService}>Promeni</button>
      </div>

      <div className="pb-block">
        <h2 className="pb-subtitle" id="pb-employee-title">Zaposleni</h2>
        {props.employeesLoading ? (
          <p className="pb-muted" role="status">Učitavamo zaposlene…</p>
        ) : props.employeesError ? (
          <div className="pb-alert" role="alert">
            <span>Zaposlene trenutno nije moguće učitati.</span>
            <button type="button" className="pb-link" onClick={props.onRetryEmployees}>Pokušaj ponovo</button>
          </div>
        ) : employees.length === 0 ? (
          <p className="pb-muted" role="status">Za ovu uslugu trenutno nema zaposlenih koji primaju online rezervacije.</p>
        ) : employees.length === 1 ? (
          <p className="pb-single-employee"><span className="pb-avatar" aria-hidden="true">{employees[0].name.slice(0, 1).toUpperCase()}</span>{employees[0].name}</p>
        ) : (
          <div className="pb-chips pb-chips-wrap" role="radiogroup" aria-labelledby="pb-employee-title">
            {employees.map((item) => (
              <button type="button" role="radio" aria-checked={item.id === selectedEmployeeId} key={item.id} className={`pb-chip pb-chip-employee${item.id === selectedEmployeeId ? " is-active" : ""}`} onClick={() => props.onSelectEmployee(item.id)}>
                {item.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="pb-block">
        <div className="pb-month">
          <h2 className="pb-subtitle">{formatMonthYear(selectedDate || windowStart)}</h2>
          <div className="pb-month-nav">
            <button type="button" className="pb-icon-button" aria-label="Prethodni dani" disabled={windowStart <= today} onClick={() => moveWindow(-1)}><ChevronLeft size={18} aria-hidden="true" /></button>
            <button type="button" className="pb-icon-button" aria-label="Sledeći dani" onClick={() => moveWindow(1)}><ChevronRight size={18} aria-hidden="true" /></button>
          </div>
        </div>
        <div className="pb-days" role="radiogroup" aria-label="Datum">
          {days.map((day) => {
            const parts = getDayParts(day);
            const selected = day === selectedDate;
            return (
              <button type="button" role="radio" aria-checked={selected} key={day} data-date={day} className={`pb-day${selected ? " is-selected" : ""}`} onClick={() => props.onSelectDate(day)}>
                <span>{parts.weekday}</span>
                <strong>{parts.day}</strong>
              </button>
            );
          })}
        </div>
      </div>

      <div className="pb-block" aria-live="polite">
        {props.bookingError && <div className="pb-alert" role="alert">{props.bookingError}</div>}
        {!employee ? (
          employees.length > 1 && <p className="pb-muted">Izaberite zaposlenog da biste videli slobodne termine.</p>
        ) : !selectedDate ? (
          <p className="pb-muted">Izaberite datum.</p>
        ) : props.slotsLoading ? (
          <p className="pb-muted" role="status">Učitavamo slobodne termine…</p>
        ) : props.slotsError ? (
          <div className="pb-alert" role="alert">
            <span>Slobodne termine trenutno nije moguće učitati.</span>
            <button type="button" className="pb-link" onClick={props.onRetrySlots}>Pokušaj ponovo</button>
          </div>
        ) : props.slots.length === 0 ? (
          <p className="pb-empty-inline" role="status">Nema slobodnih termina za ovaj dan. Izaberite drugi dan.</p>
        ) : (
          <>
            <SlotGroup label="Pre podne" slots={morning} selectedSlot={props.selectedSlot} timeZone={timeZone} onSelectSlot={props.onSelectSlot} />
            <SlotGroup label="Posle podne" slots={afternoon} selectedSlot={props.selectedSlot} timeZone={timeZone} onSelectSlot={props.onSelectSlot} />
          </>
        )}
      </div>
    </section>
  );
}
