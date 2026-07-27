"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useSalon } from "@/context/SalonContext";
import { useAuthorization } from "@/context/AuthorizationContext";
import { useEntitlements } from "@/features/billing/hooks/useEntitlements";

import {
  getCalendarEmployees,
  type CalendarEmployee,
} from "@/services/employeeQueryService";

import {
  getCalendarAppointments,
  getCalendarAppointmentById,
  getClientAppointmentHistory,
  type CalendarAppointment,
  type ClientHistoryAppointment,
} from "@/services/calendarQueryService";

// DODATO: Importujemo i Service tip, kao i funkciju za povlačenje usluga sa beka
import { Service } from "@/types/service";
// Napomena: Zamenio sam pretpostavljeni servis. Ako ti se funkcija za povlačenje usluga zove drugačije, samo ovde promeni naziv
 
import { getSalonServices } from "@/services/serviceService";

// DODATO: Uvoz servisa za kreiranje novog termina i tipa forme
import { createOwnerAppointment as createAppointment, rescheduleOwnerAppointment as rescheduleAppointment, updateOwnerAppointmentDetails as updateAppointmentDetails, updateOwnerAppointmentStatus as updateAppointmentStatus } from "@/features/appointments/services/ownerAppointmentMutationService";
import { CreateAppointmentFormInput } from "@/types/appointment";
import {
  EmployeeAppointmentError,
  updateOwnAppointmentStatus,
} from "@/services/employeeAppointmentService";
import {
  DEFAULT_SALON_TIME_ZONE,
  addDaysToDateKey,
  getTodayDateKey,
} from "@/lib/salonDateTime";
import {
  getSalonWorkingHours,
  WORKING_HOURS_CHANGED_EVENT,
  WORKING_HOURS_VERSION_KEY,
} from "@/services/workingService";
import type { WorkingHour } from "@/types/workingHour";
import {
  CALENDAR_HOUR_HEIGHT,
  calculateCalendarItemTop,
  calculateCurrentTimeLineTop,
  deriveCalendarVisibleRange,
} from "@/features/calendar/calendarTimeRange";

import AppointmentDetailsPanel from "./AppointmentDetailsPanel";
import CalendarAppointmentCard from "./CalendarAppointmentCard";
import CalendarToolbar from "./CalendarToolbar";
import RescheduleAppointmentModal from "./RescheduleAppointmentModal";
import EditAppointmentModal from "./EditAppointmentModal";

// DODATO: Uvoz novog modala za kreiranje termina
import { CreateAppointmentModal } from "./CreateAppointmentModal";
import EmployeeCreateAppointmentModal from "./EmployeeCreateAppointmentModal";

import "./calendar.css";
import "../appointmets/appointments.css";

// ==========================================
// Pomoćne funkcije i konstante
// ==========================================

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

function calculateAppointmentHeight(startTime: string, endTime: string) {
  const start = new Date(startTime);
  const end = new Date(endTime);
  const diffInMinutes = (end.getTime() - start.getTime()) / 1000 / 60;
  return (diffInMinutes / 60) * CALENDAR_HOUR_HEIGHT;
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
  const { currentRole, currentEmployee } = useAuthorization();
  const isEmployeeReadOnly = currentRole === "employee";
  const salonTimeZone = currentSalon?.timezone || DEFAULT_SALON_TIME_ZONE;
  const searchParams = useSearchParams();
  const linkedAppointmentId = searchParams.get("appointment");
  const { entitlements } = useEntitlements();
  const subscriptionReadOnly = entitlements?.effectiveCapabilities.canCreateAppointments === false;
  const canMutateAppointments = entitlements?.effectiveCapabilities.canCreateAppointments === true;

  // State menadžment
  const [selectedDate, setSelectedDate] = useState(() =>
    getTodayDateKey(currentSalon?.timezone || DEFAULT_SALON_TIME_ZONE),
  );
  const [employees, setEmployees] = useState<CalendarEmployee[]>([]);
  const [services, setServices] = useState<Service[]>([]); // DODATO: Držanje usluga salona u state-u
  const [appointments, setAppointments] = useState<CalendarAppointment[]>([]);
  const [workingHours, setWorkingHours] = useState<WorkingHour[]>([]);
  const [workingHoursVersion, setWorkingHoursVersion] = useState(0);
  
  const [employeesLoading, setEmployeesLoading] = useState(false);
  const [servicesLoading, setServicesLoading] = useState(false); // DODATO: Loading za usluge
  const [appointmentsLoading, setAppointmentsLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedAppointment, setSelectedAppointment] = useState<CalendarAppointment | null>(null);
  const [mobileEmployeeId, setMobileEmployeeId] = useState("all");

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
        const data = isEmployeeReadOnly && currentEmployee
          ? [{
              id: currentEmployee.id,
              full_name: currentEmployee.full_name,
              display_name: currentEmployee.display_name,
              position: currentEmployee.position,
            }]
          : await getCalendarEmployees(currentSalon.id);
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
  }, [currentEmployee, currentSalon, isEmployeeReadOnly]);

  // DODATO: useEffect za učitavanje usluga salona
  useEffect(() => {
    async function loadServices() {
      if (!currentSalon || isEmployeeReadOnly) return;

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
  }, [currentSalon, isEmployeeReadOnly]);

  // useEffect: Učitavanje termina pri promeni salona ili datuma
  useEffect(() => {
    let isMounted = true;

    async function loadAppointments() {
      if (!currentSalon) return;

      try {
        setAppointmentsLoading(true);
        const data = await getCalendarAppointments(
          currentSalon.id,
          selectedDate,
          salonTimeZone,
        );
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
  }, [currentSalon, salonTimeZone, selectedDate]);

  useEffect(() => {
    if (!currentSalon) return;
    let ignore = false;
    getSalonWorkingHours(currentSalon.id)
      .then((data) => {
        if (!ignore) setWorkingHours(data);
      })
      .catch((workingHoursError) => {
        console.error("Failed to load Calendar working hours:", workingHoursError);
        if (!ignore) setWorkingHours([]);
      });
    return () => { ignore = true; };
  }, [currentSalon, workingHoursVersion]);

  useEffect(() => {
    const refresh = () => setWorkingHoursVersion((version) => version + 1);
    const handleStorage = (event: StorageEvent) => {
      if (event.key === WORKING_HOURS_VERSION_KEY) refresh();
    };
    window.addEventListener(WORKING_HOURS_CHANGED_EVENT, refresh);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener(WORKING_HOURS_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  // Operativni handler za promenu statusa na klik kružića
  const handleStatusChange = async (
    appointmentId: string,
    status: "confirmed" | "completed" | "cancelled" | "no_show"
  ) => {
    if (!currentSalon || !canMutateAppointments) {
      setError("Vaš nalog trenutno ima pristup samo za pregled. Aktivirajte paket da biste menjali termine.");
      return;
    }
    try {
      if (isEmployeeReadOnly) {
        await updateOwnAppointmentStatus(appointmentId, status);
      } else {
        await updateAppointmentStatus({
          appointmentId,
          salonId: currentSalon.id,
          nextStatus: status,
        });
      }
      
      const freshAppointments = await getCalendarAppointments(currentSalon.id, selectedDate, salonTimeZone);
      setAppointments(freshAppointments);
      
      const updated = freshAppointments.find((a) => a.id === appointmentId);
      if (updated) {
        setSelectedAppointment(updated);
      }
    } catch (err) {
      console.error("Greška prilikom operativne promene statusa:", err);
      if (
        err instanceof EmployeeAppointmentError &&
        (err.code === "INVALID_STATUS_TRANSITION" ||
          err.code === "APPOINTMENT_ALREADY_UPDATED")
      ) {
        alert("Status termina je već promenjen. Podaci će biti osveženi.");
      } else {
        alert("Sistem nije uspeo da promeni status termina.");
      }
      const freshAppointments = await getCalendarAppointments(
        currentSalon.id,
        selectedDate,
        salonTimeZone,
      );
      setAppointments(freshAppointments);
      setSelectedAppointment(
        freshAppointments.find((appointment) => appointment.id === appointmentId) ?? null,
      );
    }
  };

  // Operativni handler za potvrdu pomeranja termina - POVEZAN SA BAZOM
  const handleRescheduleConfirm = async (
    appointmentId: string,
    newStart: string,
    newEnd: string,
    newEmployeeId: string
  ) => {
    if (!currentSalon || isEmployeeReadOnly || !canMutateAppointments) return;

    try {
      await rescheduleAppointment(appointmentId, newStart, newEnd, newEmployeeId);

      const freshAppointments = await getCalendarAppointments(currentSalon.id, selectedDate, salonTimeZone);
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
    if (!currentSalon || !selectedAppointment || isEmployeeReadOnly || !canMutateAppointments) return;
    const clientId = selectedAppointment.clients?.id;

    if (!clientId) {
      alert("Nije moguće ažurirati klijenta jer ne postoji ID klijenta u selektovanom terminu.");
      return;
    }

    try {
      await updateAppointmentDetails(selectedAppointment.id, clientId, formData);

      const freshAppointments = await getCalendarAppointments(currentSalon.id, selectedDate, salonTimeZone);
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
    if (!currentSalon || isEmployeeReadOnly || !canMutateAppointments) return;

    try {
      // Pozivamo tvoj kreirani servis iz appointmentService.ts koji odrađuje insert
      await createAppointment(formData);

      // Ponovo povlačimo termine sa baze za trenutni dan da bi se novi termin odmah iscrtao
      const freshAppointments = await getCalendarAppointments(currentSalon.id, selectedDate, salonTimeZone);
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

  const visibleRange = useMemo(() => deriveCalendarVisibleRange({
    selectedDate,
    timeZone: salonTimeZone,
    workingHours,
    appointments,
  }), [appointments, salonTimeZone, selectedDate, workingHours]);
  const timeLineTop = calculateCurrentTimeLineTop(currentTime, selectedDate, salonTimeZone, visibleRange);

  if (salonLoading) return <p>Loading salon...</p>;
  if (!currentSalon) return <p>No salon selected.</p>;

  const formattedCurrentTime = currentTime.toLocaleTimeString("sr-RS", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: salonTimeZone,
  });

  const handlePreviousDay = () => {
    setSelectedDate(addDaysToDateKey(selectedDate, -1));
  };

  const handleEmployeeAppointmentCreated = async () => {
    if (!currentSalon) return;
    const freshAppointments = await getCalendarAppointments(
      currentSalon.id,
      selectedDate,
      salonTimeZone,
    );
    setAppointments(freshAppointments);
  };

  const handleNextDay = () => {
    setSelectedDate(addDaysToDateKey(selectedDate, 1));
  };

  const handleToday = () => {
    setSelectedDate(getTodayDateKey(salonTimeZone));
  };

  const mobileAppointments = appointments
    .filter(
      (appointment) =>
        isEmployeeReadOnly ||
        mobileEmployeeId === "all" ||
        appointment.employees?.id === mobileEmployeeId,
    )
    .sort(
      (first, second) =>
        new Date(first.start_time).getTime() - new Date(second.start_time).getTime(),
    );

  const statusLabels: Record<string, string> = {
    pending: "Na čekanju",
    confirmed: "Potvrđeno",
    completed: "Završeno",
    cancelled: "Otkazano",
    no_show: "Nije došao",
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
        canCreateAppointment={canMutateAppointments && (currentRole === "owner" || currentRole === "employee")}
      />

      {isEmployeeReadOnly && (
        <p className="calendar-readonly-notice">
          Možete kreirati termine za sebe i menjati njihov status. Uređivanje i pomeranje nisu dostupni.
        </p>
      )}
      {subscriptionReadOnly && <p className="calendar-readonly-notice">Vaš nalog trenutno ima pristup samo za pregled. Aktivirajte paket da biste menjali termine.</p>}

      {appointmentsLoading && <p>Loading appointments...</p>}
      {employeesLoading && <p>Loading employees...</p>}
      {servicesLoading && <p>Loading services...</p>}
      {error && <p>{error}</p>}

      {!employeesLoading && !error && employees.length === 0 && (
        <p>No bookable employees found.</p>
      )}

      {!employeesLoading && employees.length > 0 && (
        <div className="calendar-content">
          <section className="calendar-mobile-agenda" aria-label="Dnevni raspored">
            {!isEmployeeReadOnly && (
              <label className="calendar-mobile-employee-filter">
                <span>Zaposleni</span>
                <select
                  value={mobileEmployeeId}
                  onChange={(event) => setMobileEmployeeId(event.target.value)}
                >
                  <option value="all">Svi zaposleni</option>
                  {employees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {getEmployeeDisplayName(employee)}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {appointmentsLoading ? (
              <div className="calendar-mobile-skeleton" aria-label="Učitavanje termina">
                <span />
                <span />
                <span />
              </div>
            ) : mobileAppointments.length === 0 ? (
              <div className="calendar-mobile-empty">
                Nema termina za izabrani dan i zaposlenog.
              </div>
            ) : (
              <ol className="calendar-mobile-list">
                {mobileAppointments.map((appointment) => {
                  const duration = Math.max(
                    0,
                    Math.round(
                      (new Date(appointment.end_time).getTime() -
                        new Date(appointment.start_time).getTime()) /
                        60000,
                    ),
                  );
                  return (
                    <li key={appointment.id}>
                      <button
                        type="button"
                        className="calendar-mobile-appointment"
                        onClick={() => setSelectedAppointment(appointment)}
                      >
                        <span className="calendar-mobile-appointment__time">
                          {new Intl.DateTimeFormat("sr-RS", {
                            hour: "2-digit",
                            minute: "2-digit",
                            timeZone: salonTimeZone,
                          }).format(new Date(appointment.start_time))}
                          <small>{duration} min</small>
                        </span>
                        <span className="calendar-mobile-appointment__body">
                          <strong>{appointment.clients?.full_name ?? "Klijent nije dostupan"}</strong>
                          <span>{appointment.services?.name ?? "Usluga nije dostupna"}</span>
                          {!isEmployeeReadOnly && mobileEmployeeId === "all" && (
                            <small>
                              {appointment.employees?.display_name ||
                                appointment.employees?.full_name ||
                                "Zaposleni nije dostupan"}
                            </small>
                          )}
                        </span>
                        <span className={`calendar-mobile-status calendar-mobile-status--${appointment.status}`}>
                          {statusLabels[appointment.status] ?? appointment.status}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
          <section className="calendar-shell">
            
            <div
              className="calendar-grid-header"
              style={{
                gridTemplateColumns: `90px repeat(${employees.length}, 1fr)`,
              }}
            >
              <div className="timezone-cell">{salonTimeZone}</div>
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
              {visibleRange.hourLabels.map((hour) => (
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
                        const top = calculateCalendarItemTop(
                          appointment.start_time,
                          selectedDate,
                          salonTimeZone,
                          visibleRange.startMinute,
                        );
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
            employeeStatusOnly={isEmployeeReadOnly || subscriptionReadOnly}
            onClose={() => setSelectedAppointment(null)}
          />
        </div>
      )}

      {!isEmployeeReadOnly && !subscriptionReadOnly && selectedAppointment && (
        <RescheduleAppointmentModal
          isOpen={isRescheduleModalOpen}
          onClose={() => setIsRescheduleModalOpen(false)}
          appointment={selectedAppointment}
          employees={employees}
          onRescheduleConfirm={handleRescheduleConfirm}
        />
      )}

      {!isEmployeeReadOnly && !subscriptionReadOnly && selectedAppointment && (
        <EditAppointmentModal
          key={selectedAppointment.id}
          isOpen={isEditModalOpen}
          onClose={() => setIsEditModalOpen(false)}
          appointment={selectedAppointment}
          onUpdateConfirm={handleEditConfirm}
        />
      )}

      {/* DODATO: Renderovanje CreateAppointmentModal komponente sa prosleđenim podacima */}
      {!isEmployeeReadOnly && !subscriptionReadOnly && <CreateAppointmentModal
        isOpen={isCreateAppointmentModalOpen}
        onClose={() => setIsCreateAppointmentModalOpen(false)}
        salonId={currentSalon.id}
        employees={employees}
        services={services}
        selectedDate={selectedDate} // Podrazumevano prosleđuje trenutno otvoren datum na kalendaru
        onSuccess={handleCreateAppointmentConfirm}
      />}

      {isEmployeeReadOnly && !subscriptionReadOnly && isCreateAppointmentModalOpen && (
        <EmployeeCreateAppointmentModal
          isOpen
          onClose={() => setIsCreateAppointmentModalOpen(false)}
          selectedDate={selectedDate}
          salonTimeZone={currentSalon.timezone}
          onCreated={handleEmployeeAppointmentCreated}
        />
      )}
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
