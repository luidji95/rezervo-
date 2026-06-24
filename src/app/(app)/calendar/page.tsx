"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useSalon } from "@/context/SalonContext";

import {
  getCalendarEmployees,
  type CalendarEmployee,
} from "@/services/employeeQueryService";

import {
  getCalendarAppointments,
  getCalendarAppointmentById,
  getClientAppointmentHistory,
  updateAppointmentStatus,
  type CalendarAppointment,
  type ClientHistoryAppointment,
} from "@/services/calendarQueryService";

// DODATO: Importujemo i Service tip, kao i funkciju za povlačenje usluga sa beka
import { Service } from "@/types/service";
// Napomena: Zamenio sam pretpostavljeni servis. Ako ti se funkcija za povlačenje usluga zove drugačije, samo ovde promeni naziv
 
import { getSalonServices } from "@/services/serviceService";

// DODATO: Uvoz servisa za kreiranje novog termina i tipa forme
import { rescheduleAppointment, updateAppointmentDetails, createAppointment } from "@/services/appointmentService";
import { CreateAppointmentFormInput } from "@/types/appointment";

import AppointmentDetailsPanel from "./AppointmentDetailsPanel";
import CalendarAppointmentCard from "./CalendarAppointmentCard";
import CalendarToolbar from "./CalendarToolbar";
import RescheduleAppointmentModal from "./RescheduleAppointmentModal";
import EditAppointmentModal from "./EditAppointmentModal";

// DODATO: Uvoz novog modala za kreiranje termina
import { CreateAppointmentModal } from "./CreateAppointmentModal";

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

function getAppointmentDateInputValue(dateString: string) {
  const parts = new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Europe/Belgrade",
  }).formatToParts(new Date(dateString));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function CalendarPageContent() {
  const { currentSalon, salonLoading } = useSalon();
  const searchParams = useSearchParams();
  const linkedAppointmentId = searchParams.get("appointment");

  // State menadžment
  const [selectedDate, setSelectedDate] = useState(getTodayDateInputValue());
  const [employees, setEmployees] = useState<CalendarEmployee[]>([]);
  const [services, setServices] = useState<Service[]>([]); // DODATO: Držanje usluga salona u state-u
  const [appointments, setAppointments] = useState<CalendarAppointment[]>([]);
  
  const [employeesLoading, setEmployeesLoading] = useState(false);
  const [servicesLoading, setServicesLoading] = useState(false); // DODATO: Loading za usluge
  const [appointmentsLoading, setAppointmentsLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedAppointment, setSelectedAppointment] = useState<CalendarAppointment | null>(null);

  const [clientHistory, setClientHistory] = useState<ClientHistoryAppointment[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [currentTime, setCurrentTime] = useState(new Date());

  // State za kontrolu vidljivosti modala
  const [isRescheduleModalOpen, setIsRescheduleModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isCreateAppointmentModalOpen, setIsCreateAppointmentModalOpen] = useState(false);

  useEffect(() => {
    if (!currentSalon || !linkedAppointmentId) return;

    let ignore = false;
    const salonId = currentSalon.id;

    async function loadLinkedAppointment() {
      try {
        const appointment = await getCalendarAppointmentById(
          salonId,
          linkedAppointmentId as string
        );

        if (!ignore) {
          setSelectedDate(getAppointmentDateInputValue(appointment.start_time));
          setSelectedAppointment(appointment);
        }
      } catch (linkedAppointmentError) {
        console.error(
          "Greška pri otvaranju termina iz notifikacije:",
          linkedAppointmentError
        );
      }
    }

    void loadLinkedAppointment();

    return () => {
      ignore = true;
    };
  }, [currentSalon, linkedAppointmentId]);

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

  // DODATO: useEffect za učitavanje usluga salona
  useEffect(() => {
    async function loadServices() {
      if (!currentSalon) return;

      try {
        setServicesLoading(true);
        // Pozivamo tvoj query servis za povlačenje svih usluga ovog salona
        const data = await getSalonServices(currentSalon.id); 
        setServices(data);
      } catch (err) {
        console.error("Greška prilikom učitavanja usluga salona:", err);
      } finally {
        setServicesLoading(false);
      }
    }

    loadServices();
  }, [currentSalon]);

  // useEffect: Učitavanje termina pri promeni salona ili datuma
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
      await updateAppointmentStatus(appointmentId, status);
      
      const freshAppointments = await getCalendarAppointments(currentSalon.id, selectedDate);
      setAppointments(freshAppointments);
      
      const updated = freshAppointments.find((a) => a.id === appointmentId);
      if (updated) {
        setSelectedAppointment(updated);
      }
    } catch (err) {
      console.error("Greška prilikom operativne promene statusa:", err);
      alert("Sistem nije uspeo da promeni status termina.");
    }
  };

  // Operativni handler za potvrdu pomeranja termina - POVEZAN SA BAZOM
  const handleRescheduleConfirm = async (
    appointmentId: string,
    newStart: string,
    newEnd: string,
    newEmployeeId: string
  ) => {
    if (!currentSalon) return;

    try {
      await rescheduleAppointment(appointmentId, newStart, newEnd, newEmployeeId);

      const freshAppointments = await getCalendarAppointments(currentSalon.id, selectedDate);
      setAppointments(freshAppointments);

      if (freshAppointments) {
        const updated = freshAppointments.find((a) => a.id === appointmentId);
        if (updated) {
          setSelectedAppointment(updated);
        }
      }

      setIsRescheduleModalOpen(false);
    } catch (err) {
      console.error("Greška prilikom pomeranja termina u bazi:", err);
      alert("Sistem nije uspeo da pomeri termin. Proveri konzolu.");
    }
  };

  // Operativni handler za izmenu detalja postojećeg termina
  const handleEditConfirm = async (formData: {
    fullName: string;
    phone: string;
    email: string;
    internalNote: string;
    customerNote: string;
  }) => {
    if (!currentSalon || !selectedAppointment) return;
    const clientId = selectedAppointment.clients?.id;

    if (!clientId) {
      alert("Nije moguće ažurirati klijenta jer ne postoji ID klijenta u selektovanom terminu.");
      return;
    }

    try {
      await updateAppointmentDetails(selectedAppointment.id, clientId, formData);

      const freshAppointments = await getCalendarAppointments(currentSalon.id, selectedDate);
      setAppointments(freshAppointments);
      
      const updated = freshAppointments.find((a) => a.id === selectedAppointment.id);
      if (updated) {
        setSelectedAppointment(updated);
      }
      
      setIsEditModalOpen(false);
    } catch (err) {
      console.error("Greška pri ažuriranju detalja termina u bazi:", err);
      alert("Sistem nije uspeo da sačuva izmene. Proveri konzolu.");
    }
  };

  // DODATO: Operativni handler za upis NOVOG termina u bazu podataka (Supabase)
  const handleCreateAppointmentConfirm = async (formData: CreateAppointmentFormInput) => {
    if (!currentSalon) return;

    try {
      // Pozivamo tvoj kreirani servis iz appointmentService.ts koji odrađuje insert
      await createAppointment(formData);

      // Ponovo povlačimo termine sa baze za trenutni dan da bi se novi termin odmah iscrtao
      const freshAppointments = await getCalendarAppointments(currentSalon.id, selectedDate);
      setAppointments(freshAppointments);

      setIsCreateAppointmentModalOpen(false);
    } catch (err) {
      console.error("Greška prilikom kreiranja novog termina u bazi:", err);
      alert("Sistem nije uspeo da zakaže novi termin.");
    }
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
        onCreateClick={() => setIsCreateAppointmentModalOpen(true)}
      />

      {appointmentsLoading && <p>Loading appointments...</p>}
      {employeesLoading && <p>Loading employees...</p>}
      {servicesLoading && <p>Loading services...</p>}
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
            onEditClick={() => setIsEditModalOpen(true)}
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

      {selectedAppointment && (
        <EditAppointmentModal
          key={selectedAppointment.id}
          isOpen={isEditModalOpen}
          onClose={() => setIsEditModalOpen(false)}
          appointment={selectedAppointment}
          onUpdateConfirm={handleEditConfirm}
        />
      )}

      {/* DODATO: Renderovanje CreateAppointmentModal komponente sa prosleđenim podacima */}
      <CreateAppointmentModal
        isOpen={isCreateAppointmentModalOpen}
        onClose={() => setIsCreateAppointmentModalOpen(false)}
        salonId={currentSalon.id}
        employees={employees}
        services={services}
        selectedDate={selectedDate} // Podrazumevano prosleđuje trenutno otvoren datum na kalendaru
        onSuccess={handleCreateAppointmentConfirm}
      />
    </main>
  );
}

export default function CalendarPage() {
  return (
    <Suspense fallback={<p>Učitavanje kalendara...</p>}>
      <CalendarPageContent />
    </Suspense>
  );
}
