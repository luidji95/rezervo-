"use client";

import { ChevronLeft } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

export const BOOKING_STEPS = ["Usluga", "Termin", "Podaci", "Potvrda"] as const;

type ProgressProps = { step: 1 | 2 | 3 | 4; onBack?: () => void; backLabel?: string };

export function PublicBookingProgress({ step, onBack, backLabel = "Nazad" }: ProgressProps) {
  return (
    <div className="pb-progress">
      <div className="pb-progress-row">
        {onBack ? (
          <button type="button" className="pb-icon-button" onClick={onBack} aria-label={backLabel}>
            <ChevronLeft size={20} aria-hidden="true" />
          </button>
        ) : <span className="pb-progress-spacer" aria-hidden="true" />}
        <p className="pb-progress-label">Korak {step} od {BOOKING_STEPS.length}</p>
        <span className="pb-progress-name">{BOOKING_STEPS[step - 1]}</span>
      </div>
      <ol className="pb-progress-track" aria-label={`Korak ${step} od ${BOOKING_STEPS.length}: ${BOOKING_STEPS[step - 1]}`}>
        {BOOKING_STEPS.map((label, index) => (
          <li key={label} className={index < step ? "is-done" : ""} aria-current={index + 1 === step ? "step" : undefined}>
            <span className="pb-sr-only">{label}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

// True while a text field is focused on a touch device or the visual viewport is shrunk by the on-screen keyboard.
// The bottom bar then leaves its sticky position so it can never cover the field, its error or the buttons.
function useSoftKeyboardOpen() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const coarse = window.matchMedia("(pointer: coarse)");
    const viewport = window.visualViewport;
    const isTextField = (element: Element | null) =>
      element instanceof HTMLElement && element.matches("input:not([type=checkbox]):not([type=radio]), textarea, select");
    const update = () => {
      const shrunk = viewport ? viewport.height < window.innerHeight - 120 : false;
      setOpen((coarse.matches && isTextField(document.activeElement)) || shrunk);
    };
    const deferredUpdate = () => window.setTimeout(update, 0);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", deferredUpdate);
    viewport?.addEventListener("resize", update);
    return () => {
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", deferredUpdate);
      viewport?.removeEventListener("resize", update);
    };
  }, []);
  return open;
}

type BarProps = { summary?: ReactNode; children: ReactNode; message?: ReactNode };

export function PublicBookingBar({ summary, children, message }: BarProps) {
  const keyboardOpen = useSoftKeyboardOpen();
  return (
    <div className={`pb-bar${keyboardOpen ? " is-inline" : ""}`} data-keyboard-open={keyboardOpen ? "true" : "false"}>
      {message}
      {summary && <div className="pb-bar-summary">{summary}</div>}
      {children}
    </div>
  );
}

export function PublicBookingFooter() {
  return <p className="pb-powered">Pokreće <strong>Rezervo</strong></p>;
}
