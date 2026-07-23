"use client";

import { useEffect, useRef } from "react";

export function useEmployeeDialog(onClose: () => void, closeDisabled = false) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const closeDisabledRef = useRef(closeDisabled);

  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => { closeDisabledRef.current = closeDisabled; }, [closeDisabled]);

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog?.querySelector<HTMLElement>("input, button, textarea, select")?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !closeDisabledRef.current) {
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = dialog?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);

  return dialogRef;
}
