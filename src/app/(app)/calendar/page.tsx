"use client";

import { useEffect, useState } from "react";
import { useSalon } from "@/context/SalonContext";

import {
  getCalendarEmployees,
  type CalendarEmployee,
} from "@/services/employeeQueryService";

import {
  getCalendarAppointments,
  getClientAppointmentHistory,
  updateAppointmentStatus,
  type CalendarAppointment,
  type ClientHistoryAppointment,
} from "@/services/calendarQueryService";

import AppointmentDetailsPanel from "./AppointmentDetailsPanel";
import CalendarAppointmentCard from "./CalendarAppointmentCard";
import CalendarToolbar from "./CalendarToolbar";
import RescheduleAppointmentModal from "./RescheduleAppointmentModal";

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

  const [clientHistory, setClientHistory] = useState<ClientHistoryAppointment[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [currentTime, setCurrentTime] = useState(new Date());

  // State za kontrolu vidljivosti modala
  const [isRescheduleModalOpen, setIsRescheduleModalOpen] = useState(false);

  // useEffect: Učitavanje zaposlenih (trigeruje se samo pri promeni salona)
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

  // useEffect: Učitavanje termina pri promeni salona ili datuma
  // Svi loading statusi i ažuriranja su unutar asinhronog izvršavanja, čime se sprečava kaskadni render
  useEffect(() => {
    let isMounted = true;

    async function loadAppointments() {
      if (!currentSalon) return;

      try {
        setAppointmentsLoading(true);
        const data = await getCalendarAppointments(currentSalon.id, selectedDate);
        if (isMounted) {
          setAppointments(data);
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : "Failed to load appointments.");
        }
      } finally {
        if (isMounted) {
          setAppointmentsLoading(false);
        }
      }
    }

    loadAppointments();

    return () => {
      isMounted = false;
    };
  }, [currentSalon, selectedDate]);

  // Operativni handler za promenu statusa na klik kružića
  const handleStatusChange = async (
    appointmentId: string,
    status: "confirmed" | "completed" | "cancelled" | "no_show"
  ) => {
    if (!currentSalon) return;
    try {
      // 1. Apdejtuj status u bazi
      await updateAppointmentStatus(appointmentId, status);
      
      // 2. Povuci najsvežije stanje direktno u akciji klikom
      const freshAppointments = await getCalendarAppointments(currentSalon.id, selectedDate);
      setAppointments(freshAppointments);
      
      // 3. Bezbedno osveži panel sa novim stanjem tog termina
      const updated = freshAppointments.find((a) => a.id === appointmentId);
      if (updated) {
        setSelectedAppointment(updated);
      }
    } catch (err) {
      console.error("Greška prilikom operativne promene statusa:", err);
      alert("Sistem nije uspeo da promeni status termina.");
    }
  };

  // UX Skeleton handler za potvrdu pomeranja termina
  const handleRescheduleConfirm = async (
    appointmentId: string,
    newStart: string,
    newEnd: string,
    newEmployeeId: string
  ) => {
    console.log("=== RESCHEDULE SKELETON FLOW USPEŠAN ===");
    console.log("ID termina:", appointmentId);
    console.log("Novo startno vreme (ISO):", newStart);
    console.log("Novo krajnje vreme (ISO):", newEnd);
    console.log("ID selektovanog zaposlenog:", newEmployeeId);
    
    setIsRescheduleModalOpen(false);
  };

  // useEffect: Učitavanje istorije selektovanog klijenta
  useEffect(() => {
    async function loadClientHistory() {
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
  }, [selectedAppointment?.clients?.id, selectedAppointment?.id]);

  // Live ažuriranje crvene linije vremena
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000);

    return () => clearInterval(interval);
  }, []);

  if (salonLoading) return <p>Loading salon...</p>;
  if (!currentSalon) return <p>No salon selected.</p>;

  function calculateTimeLineTop(time: Date) {
    const currentHours = time.getHours();
    const currentMinutes = time.getMinutes();
    
    const calendarStartHour = 8;
    const calendarEndHour = 20;   
    const hourHeight = 112;       

    if (currentHours < calendarStartHour || currentHours >= calendarEndHour) {
      return null;
    }

    const totalMinutesSinceStart = (currentHours - calendarStartHour) * 60 + currentMinutes;
    return (totalMinutesSinceStart / 60) * hourHeight;
  }

  const timeLineTop = calculateTimeLineTop(currentTime);

  const formattedCurrentTime = currentTime.toLocaleTimeString("sr-RS", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const handlePreviousDay = () => {
    const current = new Date(selectedDate);
    current.setDate(current.getDate() - 1);
    setSelectedDate(current.toISOString().split('T')[0]);
  };

  const handleNextDay = () => {
    const current = new Date(selectedDate);
    current.setDate(current.getDate() + 1);
    setSelectedDate(current.toISOString().split('T')[0]);
  };

  const handleToday = () => {
    setSelectedDate(getTodayDateInputValue());
  };

  return (
    <main className="calendar-page">
      <CalendarToolbar
        selectedDate={selectedDate}
        onDateChange={setSelectedDate}
        onPreviousDay={handlePreviousDay}
        onNextDay={handleNextDay}
        onToday={handleToday}
        employees={employees}
        getEmployeeDisplayName={getEmployeeDisplayName}
      />

      {appointmentsLoading && <p>Loading appointments...</p>}
      {employeesLoading && <p>Loading employees...</p>}
      {error && <p>{error}</p>}

      {!employeesLoading && !error && employees.length === 0 && (
        <p>No bookable employees found.</p>
      )}

      {!employeesLoading && employees.length > 0 && (
        <div className="calendar-content">
          <section className="calendar-shell">
            
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
                    <div className="time-badge">{formattedCurrentTime}</div>
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
                        const isSelected = selectedAppointment?.id === appointment.id;

                        return (
                          <CalendarAppointmentCard
                            key={appointment.id}
                            appointment={appointment}
                            top={top}
                            height={height}
                            isSelected={isSelected}
                            onSelect={setSelectedAppointment}
                          />
                        );
                      })}
                  </div>
                ))}
              </div>
            </div>
          </section>

          <AppointmentDetailsPanel
            selectedAppointment={selectedAppointment}
            clientHistory={clientHistory}
            historyLoading={historyLoading}
            onStatusChange={handleStatusChange}
            onRescheduleClick={() => setIsRescheduleModalOpen(true)}
          />
        </div>
      )}

      {selectedAppointment && (
        <RescheduleAppointmentModal
          isOpen={isRescheduleModalOpen}
          onClose={() => setIsRescheduleModalOpen(false)}
          appointment={selectedAppointment}
          employees={employees}
          onRescheduleConfirm={handleRescheduleConfirm}
        />
      )}
    </main>
  );
}