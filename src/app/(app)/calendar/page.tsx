"use client";

import { useEffect, useState } from "react";
import { useSalon } from "@/context/SalonContext";

// Ikonice za verniji izgled prema dizajnu sa slike
import { 
  Phone, 
  Mail, 
  User, 
  Clock, 
  Calendar, 
  CheckCircle2, 
  Edit3, 
  CalendarRange, 
  Trash2 
} from "lucide-react";

import {
  getCalendarEmployees,
  type CalendarEmployee,
} from "@/services/employeeQueryService";


import {
  getCalendarAppointments,
  getClientAppointmentHistory, // <-- DODAJ OVO
  type CalendarAppointment,
  type ClientHistoryAppointment, // <-- DODAJ OVO
} from "@/services/calendarQueryService";

import "./calendar.css";

// ==========================================
// Pomoćne funkcije i konstante
// ==========================================

const HOURS = [
  "08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00",
  "15:00", "16:00", "17:00", "18:00", "19:00", "20:00",
];

function getTodayDateInputValue() {
  return new Date().toISOString().slice(0, 10);
}

function getEmployeeDisplayName(employee: CalendarEmployee) {
  return employee.display_name || employee.full_name;
}

function getEmployeeInitials(employee: CalendarEmployee) {
  const name = getEmployeeDisplayName(employee);
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function getMinutesSinceStartOfDay(dateString: string) {
  const date = new Date(dateString);
  return date.getHours() * 60 + date.getMinutes();
}

function calculateAppointmentTop(startTime: string) {
  const minutes = getMinutesSinceStartOfDay(startTime);
  const calendarStartHour = 8;
  return ((minutes - calendarStartHour * 60) / 60) * 112;
}

function calculateAppointmentHeight(startTime: string, endTime: string) {
  const start = new Date(startTime);
  const end = new Date(endTime);
  const diffInMinutes = (end.getTime() - start.getTime()) / 1000 / 60;
  return (diffInMinutes / 60) * 112;
}

function formatAppointmentDuration(startTime: string, endTime: string) {
  const start = new Date(startTime);
  const end = new Date(endTime);
  const minutes = Math.round((end.getTime() - start.getTime()) / 1000 / 60);
  return `${minutes} min`;
}

function formatAppointmentDate(value: string) {
  // Prilagođeno formatu sa slike: "Petak, 16. Maj 2025."
  const date = new Date(value);
  const formatted = date.toLocaleDateString("sr-RS", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  // Kapitalizacija prvog slova dana i meseca radi lepšeg izgleda
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

function getAppointmentEmployeeName(appointment: CalendarAppointment) {
  return (
    appointment.employees?.display_name ||
    appointment.employees?.full_name ||
    "Zaposleni"
  );
}

// ==========================================
// Glavna Komponenta
// ==========================================

export default function CalendarPage() {
  const { currentSalon, salonLoading } = useSalon();

  // State menadžment
  const [selectedDate, setSelectedDate] = useState(getTodayDateInputValue());
  const [employees, setEmployees] = useState<CalendarEmployee[]>([]);
  const [appointments, setAppointments] = useState<CalendarAppointment[]>([]);
  
  const [employeesLoading, setEmployeesLoading] = useState(false);
  const [appointmentsLoading, setAppointmentsLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedAppointment, setSelectedAppointment] = useState<CalendarAppointment | null>(null);

  // Ispod tvog state-a za selectedAppointment dodaj ovo:
  const [clientHistory, setClientHistory] = useState<ClientHistoryAppointment[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [currentTime, setCurrentTime] = useState(new Date());



  // useEffect: Učitavanje zaposlenih
  useEffect(() => {
    async function loadEmployees() {
      if (!currentSalon) return;

      try {
        setEmployeesLoading(true);
        setError("");
        const data = await getCalendarEmployees(currentSalon.id);
        setEmployees(data);
      } catch (err) {
        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError("Failed to load employees.");
        }
      } finally {
        setEmployeesLoading(false);
      }
    }

    loadEmployees();
  }, [currentSalon]);

  // useEffect: Učitavanje termina
  useEffect(() => {
    async function loadAppointments() {
      if (!currentSalon) return;

      try {
        setAppointmentsLoading(true);
        setError("");
        const data = await getCalendarAppointments(currentSalon.id, selectedDate);
        setAppointments(data);
      } catch (err) {
        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError("Failed to load appointments.");
        }
      } finally {
        setAppointmentsLoading(false);
      }
    }

    loadAppointments();
  }, [currentSalon, selectedDate]);

  useEffect(() => {
  async function loadClientHistory() {
    // Ako nema selektovanog termina ili klijent nema ID, praznimo istoriju i prekidamo
    if (!selectedAppointment?.clients?.id) {
      setClientHistory([]);
      return;
    }

    try {
      setHistoryLoading(true);
      const historyData = await getClientAppointmentHistory(
        selectedAppointment.clients.id,
        selectedAppointment.id
      );
      setClientHistory(historyData);
    } catch (err) {
      console.error("Greška pri učitavanju istorije klijenta:", err);
    } finally {
      setHistoryLoading(false);
    }
  }

  loadClientHistory();
}, [selectedAppointment]);

useEffect(() => {
  // Ažuriraj vrijeme svake minute
  const interval = setInterval(() => {
    setCurrentTime(new Date());
  }, 60000); // 60000 ms = 1 minuta

  return () => clearInterval(interval);
}, []);

  if (salonLoading) {
    return <p>Loading salon...</p>;
  }

  if (!currentSalon) {
    return <p>No salon selected.</p>;
  }

  function calculateTimeLineTop(time: Date) {
  const currentHours = time.getHours();
  const currentMinutes = time.getMinutes();
  
  const calendarStartHour = 8; // Tvoj kalendar počinje u 08:00
  const calendarEndHour = 20;   // Tvoj kalendar se završava oko 20:00/21:00
  const hourHeight = 112;       // Visina jednog sata u pikselima iz tvog CSS-a

  // Ako je trenutno vrijeme van radnog vremena kalendara, sakrij liniju
  if (currentHours < calendarStartHour || currentHours >= calendarEndHour) {
    return null;
  }

  // Računamo koliko je minuta prošlo od 08:00
  const totalMinutesSinceStart = (currentHours - calendarStartHour) * 60 + currentMinutes;
  
  // Pretvaramo minute u piksele (pošto 60 minuta iznosi 'hourHeight' piksela)
  return (totalMinutesSinceStart / 60) * hourHeight;
}

// Izračunaj trenutnu poziciju (ako je null, ne prikazujemo je)
const timeLineTop = calculateTimeLineTop(currentTime);

// Formatiramo tekst za crveni kvadratić (npr. "14:15")
const formattedCurrentTime = currentTime.toLocaleTimeString("sr-RS", {
  hour: "2-digit",
  minute: "2-digit",
});

  return (
    <main className="calendar-page">
      {/* Header */}
      <header className="calendar-header">
        <div>
          <h1>Kalendar</h1>
          <p>Pregled svih termina i dostupnosti u tvom salonu.</p>
        </div>
        <button type="button" className="new-appointment-btn">
          + Novi termin
        </button>
      </header>

      {/* Alati / Toolbar */}
      <section className="calendar-toolbar">
        <button
          type="button"
          onClick={() => setSelectedDate(getTodayDateInputValue())}
        >
          Danas
        </button>

        <input
          type="date"
          value={selectedDate}
          onChange={(event) => setSelectedDate(event.target.value)}
        />

        <button type="button">Svi zaposleni</button>
        <button type="button">Filteri</button>
      </section>

      {/* Statusi i Greške */}
      {appointmentsLoading && <p>Loading appointments...</p>}
      {employeesLoading && <p>Loading employees...</p>}
      {error && <p>{error}</p>}

      {!employeesLoading && !error && employees.length === 0 && (
        <p>No bookable employees found.</p>
      )}

      {/* Glavni sadržaj kalendara */}
      {!employeesLoading && employees.length > 0 && (
        <div className="calendar-content">
          <section className="calendar-shell">
            
            {/* Zaglavlje mreže */}
            <div
              className="calendar-grid-header"
              style={{
                gridTemplateColumns: `90px repeat(${employees.length}, 1fr)`,
              }}
            >
              <div className="timezone-cell">GMT+1</div>
              {employees.map((employee) => (
                <div className="employee-header-cell" key={employee.id}>
                  <span className="employee-avatar">
                    {getEmployeeInitials(employee)}
                  </span>
                  <span className="employee-name">
                    {getEmployeeDisplayName(employee)}
                  </span>
                  <small className="employee-service">
                    {employee.position || "Zaposleni"}
                  </small>
                </div>
              ))}
            </div>

            {/* Sati i vremenski slotovi */}
            <div style={{ position: "relative" }}>
              {HOURS.map((hour) => (
                <div
                  className="calendar-row"
                  key={hour}
                  style={{
                    gridTemplateColumns: `90px repeat(${employees.length}, 1fr)`,
                  }}
                >
                  <div className="time-cell">{hour}</div>
                  {employees.map((employee) => (
                    <div className="calendar-slot-cell" key={employee.id}></div>
                  ))}
                </div>
              ))}

              {/* Lejer sa karticama termina */}
              <div
                className="calendar-appointments-layer"
                style={{
                  gridTemplateColumns: `repeat(${employees.length}, 1fr)`,
                }}
              >
                {timeLineTop !== null && (
    <div 
      className="current-time-indicator" 
      style={{ top: `${timeLineTop}px` }}
    >
      {/* Crveni kvadratić sa vremenom */}
      <div className="time-badge">{formattedCurrentTime}</div>
      
      {/* Sama crvena linija koja siječe kalendar */}
      <div className="time-line"></div>
    </div>
  )}
                {employees.map((employee) => (
                  <div key={employee.id} className="calendar-employee-column">
                    {appointments
                      .filter((appointment) => appointment.employees?.id === employee.id)
                      .map((appointment) => {
                        const top = calculateAppointmentTop(appointment.start_time);
                        const height = calculateAppointmentHeight(appointment.start_time, appointment.end_time);

                        return (
                          <div
                            key={appointment.id}
                            className="calendar-appointment-card"
                            style={{ top, height }}
                            onClick={() => setSelectedAppointment(appointment)}
                          >
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

                            <div>
                              <span className="calendar-appointment-client">
                                {appointment.clients?.full_name ?? "Klijent"}
                              </span>
                              <span className="calendar-appointment-service">
                                • {appointment.services?.name ?? "Usluga"}
                              </span>
                            </div>

                            <div className="calendar-appointment-status">
                              {appointment.status}
                            </div>
                          </div>
                        );
                      })}
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* ========================================================= */}
          {/* REFAKTORISAN: Desni panel sa detaljima (ASIDE) prema slici */}
          {/* ========================================================= */}
          <aside className="calendar-details-panel">
            {!selectedAppointment ? (
              <p className="calendar-details-empty">
                Izaberi termin iz kalendara za prikaz detalja.
              </p>
            ) : (
              <div className="details-container">
                
                {/* Gornji red: Vreme i Usluga Badge */}
                <div className="details-header-row">
                  <span className="details-time-range">
                    {new Date(selectedAppointment.start_time).toLocaleTimeString("sr-RS", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                    {" - "}
                    {new Date(selectedAppointment.end_time).toLocaleTimeString("sr-RS", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  
                  <span className="details-service-badge">
                    {selectedAppointment.services?.name ?? "Usluga"}
                  </span>
                </div>

                {/* Ime Klijenta */}
                <h2 className="details-client-name">
                  {selectedAppointment.clients?.full_name ?? "Klijent"}
                </h2>

                {/* Detalji sa ikonicama */}
                <div className="details-info-list">
                  <div className="info-item">
                    <Phone size={18} className="info-icon" />
                    <span>{selectedAppointment.clients?.phone || "Nije unet"}</span>
                  </div>

                  <div className="info-item">
                    <Mail size={18} className="info-icon" />
                    <span>{selectedAppointment.clients?.email || "Nije unet"}</span>
                  </div>

                  <div className="info-item">
                    <User size={18} className="info-icon" />
                    <span>
                      {getAppointmentEmployeeName(selectedAppointment)} ({selectedAppointment.services?.name ?? "Usluga"})
                    </span>
                  </div>

                  <div className="info-item">
                    <Clock size={18} className="info-icon" />
                    <span>
                      {formatAppointmentDuration(selectedAppointment.start_time, selectedAppointment.end_time)}
                    </span>
                  </div>

                  <div className="info-item">
                    <Calendar size={18} className="info-icon" />
                    <span>{formatAppointmentDate(selectedAppointment.start_time)}</span>
                  </div>
                </div>

                {/* Status Badge */}
                <div className="details-status-container">
                  <span className={`status-badge ${selectedAppointment.status?.toLowerCase()}`}>
                    {selectedAppointment.status ?? "Potvrđeno"}
                  </span>
                </div>

                <hr className="details-divider" />

                {/* Sekcija: Napomena */}
                <div className="details-notes-section">
                  <h3>Napomena zaposlenog</h3>
                  <p>
                    {selectedAppointment.internal_note || "Nema interne napomene za ovaj termin."}
                  </p>

                 {selectedAppointment.customer_note && (
                  <div style={{ marginTop: "12px", paddingTop: "12px", borderTop: "1px dashed #e2e8f0" }}>
                    <h3 style={{ fontSize: "14px", color: "#64748b" }}>Napomena klijenta</h3>
                    <p style={{ fontStyle: "italic" }}>{selectedAppointment.customer_note}</p>
                  </div>
                )}
                </div>

                <hr className="details-divider" />

                {/* Sekcija: Istorija termina */}
<div className="details-history-section">
  <h3>Istorija termina</h3>
  
  {historyLoading && <p style={{ fontSize: "14px", color: "#667085" }}>Učitavam istoriju...</p>}

  {!historyLoading && clientHistory.length === 0 && (
    <p style={{ fontSize: "14px", color: "#667085", fontStyle: "italic" }}>
      Ovo je prvi termin za ovog klijenta.
    </p>
  )}

  {!historyLoading && clientHistory.length > 0 && (
    <div className="history-list">
      {clientHistory.map((historyItem) => (
        <div className="history-item" key={historyItem.id}>
          <span className="history-date">
            {new Date(historyItem.start_time).toLocaleDateString("sr-RS", {
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
            })}.
          </span>
          <span className="history-service">
            {historyItem.services?.name ?? "Usluga"}
          </span>
          <CheckCircle2 size={16} className="history-check-icon" />
        </div>
      ))}
    </div>
  )}

  {clientHistory.length > 0 && (
    <button type="button" className="view-all-history-btn">
      Pogledaj sve
    </button>
  )}
</div>

                {/* Akciona dugmad sa ikonicama */}
                <div className="details-actions-stack">
                  <button type="button" className="btn-action btn-edit">
                    <Edit3 size={18} />
                    Izmeni termin
                  </button>

                  <button type="button" className="btn-action btn-reschedule">
                    <CalendarRange size={18} />
                    Pomeri termin
                  </button>

                  <button type="button" className="btn-action btn-cancel">
                    <Trash2 size={18} />
                    Otkaži termin
                  </button>
                </div>

              </div>
            )}
          </aside>
        </div>
      )}
    </main>
  );
}