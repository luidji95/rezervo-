"use client";

import { useEffect, useRef } from "react";
import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  Clock3,
  X,
  XCircle,
} from "lucide-react";
import type { ClientHistoryAppointment } from "@/services/calendarQueryService";

type ClientHistoryModalProps = {
  clientName: string;
  appointments: ClientHistoryAppointment[];
  onClose: () => void;
};

function formatHistoryDate(date: string) {
  return new Intl.DateTimeFormat("sr-RS", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
}

export function HistoryStatusBadge({ status }: { status: string }) {
  const normalizedStatus = status?.toLowerCase().trim();

  if (normalizedStatus === "completed") {
    return (
      <span className="history-status history-status--completed">
        <CheckCircle2 size={16} aria-hidden="true" />
        Završeno
      </span>
    );
  }

  if (normalizedStatus === "cancelled") {
    return (
      <span className="history-status history-status--cancelled">
        <XCircle size={16} aria-hidden="true" />
        Otkazano
      </span>
    );
  }

  if (normalizedStatus === "no_show") {
    return (
      <span className="history-status history-status--no-show">
        <AlertCircle size={16} aria-hidden="true" />
        Nije došao
      </span>
    );
  }

  if (normalizedStatus === "pending") {
    return (
      <span className="history-status history-status--pending">
        <Clock3 size={16} aria-hidden="true" />
        Na čekanju
      </span>
    );
  }

  return (
    <span className="history-status history-status--confirmed">
      <CalendarClock size={16} aria-hidden="true" />
      Potvrđeno
    </span>
  );
}

export default function ClientHistoryModal({
  clientName,
  appointments,
  onClose,
}: ClientHistoryModalProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <div
      className="history-modal-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="history-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="history-modal-title"
      >
        <header className="history-modal__header">
          <div>
            <h2 id="history-modal-title">Istorija termina</h2>
            <p>{clientName}</p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="history-modal__close"
            onClick={onClose}
            aria-label="Zatvori istoriju termina"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </header>

        <div className="history-modal__list">
          {appointments.map((appointment) => (
            <article className="history-modal__item" key={appointment.id}>
              <div className="history-modal__appointment">
                <time dateTime={appointment.start_time}>
                  {formatHistoryDate(appointment.start_time)}
                </time>
                <strong>{appointment.services?.name || "Usluga"}</strong>
              </div>
              <HistoryStatusBadge status={appointment.status} />
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
