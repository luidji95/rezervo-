"use client";

import { useEffect, useRef, useState } from "react";
import {
  Phone,
  Mail,
  User,
  Clock,
  Calendar,
  CheckCircle2,
  AlertCircle,
  Edit3,
  CalendarRange,
  Trash2,
  X,
} from "lucide-react";
import ClientHistoryModal, { HistoryStatusBadge } from "./ClientHistoryModal";
import { EmployeeStatusConfirmationModal } from "@/features/appointments/components/EmployeeStatusConfirmationModal";
import {
  getEmployeeAppointmentFinalMessage,
  getEmployeeAppointmentStatusActions,
  getEmployeeAppointmentStatusLabel,
  type EmployeeAppointmentStatusAction,
} from "@/features/appointments/employeeAppointmentStatusTransitions";

import type {
  CalendarAppointment,
  ClientHistoryAppointment,
} from "@/services/calendarQueryService";

type AppointmentDetailsPanelProps = {
  selectedAppointment: CalendarAppointment | null;
  clientHistory: ClientHistoryAppointment[];
  historyLoading: boolean;
  onStatusChange: (
    appointmentId: string,
    status: "confirmed" | "completed" | "cancelled" | "no_show"
  ) => Promise<void>;
  onRescheduleClick: () => void; // Prop za otvaranje reschedule modala
  onEditClick: () => void;       // <-- DODATO: Novi prop za otvaranje Edit modala
  employeeStatusOnly?: boolean;
  onClose: () => void;
};

function formatAppointmentDuration(start: string, end: string): string {
  const startDate = new Date(start);
  const endDate = new Date(end);
  const diffMs = endDate.getTime() - startDate.getTime();
  const diffMinutes = Math.floor(diffMs / 1000 / 60);
  return `${diffMinutes} min`;
}

function formatAppointmentDate(date: string): string {
  return new Intl.DateTimeFormat("sr-RS", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(date)) + ".";
}

function getAppointmentEmployeeName(appointment: CalendarAppointment): string {
  return (
    appointment.employees?.display_name ||
    appointment.employees?.full_name ||
    "Nepoznati zaposleni"
  );
}

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
      return status;
  }
}

export default function AppointmentDetailsPanel({
  selectedAppointment,
  clientHistory,
  historyLoading,
  onStatusChange,
  onRescheduleClick,
  onEditClick, // <-- Destrukturiran novi prop
  employeeStatusOnly = false,
  onClose,
}: AppointmentDetailsPanelProps) {
  const [localLoading, setLocalLoading] = useState(false);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [pendingAction, setPendingAction] =
    useState<EmployeeAppointmentStatusAction | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const loadingRef = useRef(localLoading);
  const onCloseRef = useRef(onClose);
  const selectedAppointmentId = selectedAppointment?.id;

  useEffect(() => {
    loadingRef.current = localLoading;
    onCloseRef.current = onClose;
  }, [localLoading, onClose]);

  useEffect(() => {
    if (!selectedAppointmentId || !window.matchMedia("(max-width: 767px)").matches) return;
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !loadingRef.current) {
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      returnFocusRef.current?.focus();
    };
  }, [selectedAppointmentId]);

  if (!selectedAppointment) {
    return (
      <aside className="calendar-details-panel calendar-details-panel--empty">
        <p className="calendar-details-empty">
          Izaberi termin iz kalendara za prikaz detalja.
        </p>
      </aside>
    );
  }

  const handleAction = async (status: "confirmed" | "completed" | "cancelled" | "no_show") => {
    if (localLoading) return;
    try {
      setLocalLoading(true);
      await onStatusChange(selectedAppointment.id, status);
    } catch (err) {
      console.error(err);
    } finally {
      setLocalLoading(false);
    }
  };

  const employeeActions = getEmployeeAppointmentStatusActions(
    selectedAppointment.status,
  );
  const employeeFinalMessage = getEmployeeAppointmentFinalMessage(
    selectedAppointment.status,
  );

  const handleEmployeeAction = (action: EmployeeAppointmentStatusAction) => {
    if (action.requiresConfirmation) {
      setPendingAction(action);
      return;
    }
    void handleAction(action.nextStatus);
  };

  return (
    <>
    <button
      type="button"
      className="calendar-details-backdrop"
      aria-label="Zatvori detalje termina"
      onClick={() => {
        if (!localLoading) onClose();
      }}
    />
    <aside
      ref={panelRef}
      className="calendar-details-panel calendar-details-panel--selected"
      role="dialog"
      aria-modal="true"
      aria-labelledby="calendar-details-title"
    >
      <header className="calendar-details-mobile-header">
        <strong id="calendar-details-title">Detalji termina</strong>
        <button
          ref={closeButtonRef}
          type="button"
          aria-label="Zatvori detalje termina"
          disabled={localLoading}
          onClick={onClose}
        >
          <X size={22} />
        </button>
      </header>
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
            {selectedAppointment.services?.name || "Usluga"}
          </span>
        </div>

        {/* Ime Klijenta */}
        <h2 className="details-client-name">
          {selectedAppointment.clients?.full_name || "Klijent"}
        </h2>

        {/* Detalji sa ikonama */}
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
              {getAppointmentEmployeeName(selectedAppointment)} ({selectedAppointment.services?.name || "Usluga"})
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
            <span>
              {new Intl.DateTimeFormat("sr-RS", {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric",
              }).format(new Date(selectedAppointment.start_time))}
            </span>
          </div>
        </div>

        {/* Status Badge */}
        <div className="details-status-container">
          <span className={`status-badge ${selectedAppointment.status?.toLowerCase()}`}>
            {employeeStatusOnly
              ? getEmployeeAppointmentStatusLabel(selectedAppointment.status)
              : getAppointmentStatusLabel(selectedAppointment.status)}
          </span>
        </div>

        <hr className="details-divider" />

        {/* Sekcija: Napomene */}
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

        {/* Sekcija: Istorija klijenta */}
        <div className="details-history-section">
          <h3>Istorija termina</h3>
          
          {historyLoading ? (
            <p style={{ fontSize: "14px", color: "#667085" }}>Učitavam istoriju...</p>
          ) : clientHistory.length === 0 ? (
            <p style={{ fontSize: "14px", color: "#667085", fontStyle: "italic" }}>
              Ovo je prvi termin za ovog klijenta.
            </p>
          ) : (
            <div className="history-list">
              {clientHistory.slice(0, 3).map((appointment) => (
                <div className="history-item" key={appointment.id}>
                  <span className="history-date">
                    {formatAppointmentDate(appointment.start_time)}
                  </span>
                  <span className="history-service">
                    {appointment.services?.name || "Usluga"}
                  </span>
                  <HistoryStatusBadge status={appointment.status} />
                </div>
              ))}
            </div>
          )}

          {clientHistory.length > 0 && (
            <button
              type="button"
              className="view-all-history-btn"
              onClick={() => setIsHistoryModalOpen(true)}
            >
              Pogledaj sve
            </button>
          )}
        </div>

        <hr className="details-divider" />

        {employeeStatusOnly ? (
          <div className="status-quick-actions-section">
            <h3>Status termina</h3>
            <p className="calendar-readonly-notice">
              Možete promeniti samo status svog termina kroz dostupne naredne korake.
            </p>
            <div className="details-actions-stack">
              {employeeActions.map((action) => (
                <button
                  key={action.nextStatus}
                  type="button"
                  className={`employee-status-action employee-status-action--${action.tone}`}
                  disabled={localLoading}
                  onClick={() => handleEmployeeAction(action)}
                >
                  {localLoading ? action.loadingLabel : action.label}
                </button>
              ))}
              {employeeActions.length === 0 && (
                <p className="employee-appointments__final-state">
                  {employeeFinalMessage || "Nema dostupnih akcija za ovaj status."}
                </p>
              )}
            </div>
          </div>
        ) : <>
        {/* BRZE STATUSNE AKCIJE */}
        <div className="status-quick-actions-section" style={{ marginBottom: "20px" }}>
          <h3 style={{ fontSize: "12px", textTransform: "uppercase", color: "#64748b", letterSpacing: "0.05em", marginBottom: "10px" }}>
            Status termina
          </h3>
          
          <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
            {/* 1. Potvrđeno (Confirmed) */}
            <button
              type="button"
              className="btn-round-status"
              style={{
                width: "40px",
                height: "40px",
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: "1px solid #e2e8f0",
                backgroundColor: selectedAppointment.status === "confirmed" ? "#e0e7ff" : "#ffffff",
                color: selectedAppointment.status === "confirmed" ? "#4f46e5" : "#64748b",
                cursor: localLoading ? "not-allowed" : "pointer",
                transition: "all 0.2s"
              }}
              title="Onači kao Potvrđeno"
              disabled={localLoading || selectedAppointment.status === "confirmed"}
              onClick={() => handleAction("confirmed")}
            >
              <Calendar size={18} />
            </button>

            {/* 2. Završeno (Completed) */}
            <button
              type="button"
              className="btn-round-status"
              style={{
                width: "40px",
                height: "40px",
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: "1px solid #e2e8f0",
                backgroundColor: selectedAppointment.status === "completed" ? "#dcfce7" : "#ffffff",
                color: selectedAppointment.status === "completed" ? "#16a34a" : "#64748b",
                cursor: localLoading ? "not-allowed" : "pointer",
                transition: "all 0.2s"
              }}
              title="Onači kao Završeno"
              disabled={localLoading || selectedAppointment.status === "completed"}
              onClick={() => handleAction("completed")}
            >
              <CheckCircle2 size={18} />
            </button>

            {/* 3. Nije došao (No Show) */}
            <button
              type="button"
              className="btn-round-status"
              style={{
                width: "40px",
                height: "40px",
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: "1px solid #e2e8f0",
                backgroundColor: selectedAppointment.status === "no_show" ? "#f1f5f9" : "#ffffff",
                color: selectedAppointment.status === "no_show" ? "#475569" : "#64748b",
                cursor: localLoading ? "not-allowed" : "pointer",
                transition: "all 0.2s"
              }}
              title="Onači kao Nije došao"
              disabled={localLoading || selectedAppointment.status === "no_show"}
              onClick={() => handleAction("no_show")}
            >
              <AlertCircle size={18} />
            </button>
          </div>
        </div>

        {/* GLAVNE STRUKTURALNE AKCIJE */}
        <div className="details-actions-stack">
          {/* SADA POTPUNO OPERATIVNO EDIT DUGME */}
          <button 
            type="button" 
            className="btn-action btn-edit"
            onClick={onEditClick} // <-- Aktivirana akcija na klik za izmenu
          >
            <Edit3 size={18} />
            Izmeni termin
          </button>

          <button 
            type="button" 
            className="btn-action btn-reschedule"
            onClick={onRescheduleClick}
          >
            <CalendarRange size={18} />
            Pomeri termin
          </button>

          <button 
            type="button" 
            className="btn-action btn-cancel"
            disabled={localLoading || selectedAppointment.status === "cancelled"}
            onClick={() => handleAction("cancelled")}
          >
            <Trash2 size={18} />
            Otkaži termin
          </button>
        </div>
        </>}

      </div>

      {isHistoryModalOpen && (
        <ClientHistoryModal
          clientName={selectedAppointment.clients?.full_name || "Klijent"}
          appointments={clientHistory}
          onClose={() => setIsHistoryModalOpen(false)}
        />
      )}
      <EmployeeStatusConfirmationModal
        action={pendingAction}
        loading={localLoading}
        onCancel={() => setPendingAction(null)}
        onConfirm={() => {
          if (!pendingAction) return;
          const nextStatus = pendingAction.nextStatus;
          setPendingAction(null);
          void handleAction(nextStatus);
        }}
      />
    </aside>
    </>
  );
}
