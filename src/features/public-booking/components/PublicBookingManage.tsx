"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { readManageTokenFromHash } from "@/lib/publicBookingManage/manageToken";
import { getDateKeyInTimeZone } from "@/lib/salonDateTime";
import { formatDateLong, formatTime, formatTimeRange } from "../publicBookingFormat";
import { cancelManagedBooking, getManagedBooking, type ManagedBookingView } from "../services/publicBookingService";
import { PublicBookingFooter } from "./PublicBookingChrome";

const STATUS_LABELS: Record<string, string> = {
  pending: "Na čekanju",
  confirmed: "Potvrđen",
  cancelled: "Otkazan",
  completed: "Završen",
  no_show: "Nije realizovan",
};

type CancelState = "idle" | "confirming" | "cancelling" | "cancelled" | "already_cancelled" | "too_late" | "not_cancellable" | "error";

const subscribeToHash = (onChange: () => void) => {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
};

function formatDeadline(iso: string, timeZone: string) {
  return `${formatDateLong(getDateKeyInTimeZone(new Date(iso), timeZone))} u ${formatTime(iso, timeZone)}`;
}

function SalonContact({ phone }: { phone: string | null }) {
  return phone
    ? <> kontaktirajte salon na <a className="pb-link" href={`tel:${phone}`}>{phone}</a>.</>
    : <> kontaktirajte salon.</>;
}

// Opening the page only reads the appointment; it is cancelled only after an explicit confirmation and a POST.
export function PublicBookingManage() {
  const hash = useSyncExternalStore(subscribeToHash, () => window.location.hash, () => null);
  const token = hash === null ? null : readManageTokenFromHash(hash);
  const [view, setView] = useState<{ token: string; result: ManagedBookingView } | null>(null);
  const [cancelState, setCancelState] = useState<CancelState>("idle");
  const [contactPhone, setContactPhone] = useState<string | null>(null);

  const load = useCallback(async (current: string) => {
    const result = await getManagedBooking(current);
    setView({ token: current, result });
  }, []);

  useEffect(() => {
    if (!token) return;
    let active = true;
    void getManagedBooking(token).then((result) => { if (active) setView({ token, result }); });
    return () => { active = false; };
  }, [token]);

  const cancel = async () => {
    if (!token || cancelState === "cancelling") return;
    setCancelState("cancelling");
    const result = await cancelManagedBooking(token);
    if (result.kind === "invalid") { setView({ token, result: { kind: "invalid" } }); return; }
    if (result.kind === "too_late" || result.kind === "not_cancellable") setContactPhone(result.salonPhone);
    setCancelState(result.kind);
    if (result.kind !== "error") await load(token);
  };

  if (hash === null || (token && (!view || view.token !== token))) {
    return <div className="pb-shell"><section className="pb-step" aria-busy="true"><p className="pb-lead">Učitavamo termin…</p></section></div>;
  }

  if (!token || view?.result.kind === "invalid") {
    return (
      <div className="pb-shell">
        <section className="pb-step" role="alert">
          <h1 className="pb-title">Link nije važeći</h1>
          <p className="pb-lead">Proverite da li ste otvorili ceo link koji ste sačuvali posle zakazivanja. Ako ga nemate, kontaktirajte salon.</p>
        </section>
        <PublicBookingFooter />
      </div>
    );
  }

  if (view?.result.kind !== "booking") {
    return (
      <div className="pb-shell">
        <section className="pb-step" role="alert">
          <h1 className="pb-title">Termin trenutno ne možemo da učitamo</h1>
          <p className="pb-lead">Proverite internet vezu i pokušajte ponovo.</p>
          <button type="button" className="pb-button-secondary" onClick={() => void load(token)}>Pokušaj ponovo</button>
        </section>
      </div>
    );
  }

  const booking = view.result.booking;
  const slot = { startTime: booking.startTime, endTime: booking.endTime, employeeId: "" };
  const isActive = booking.status === "pending" || booking.status === "confirmed";
  const phone = contactPhone ?? booking.salonPhone;

  return (
    <div className="pb-shell">
      <section className="pb-step pb-manage" aria-labelledby="pb-manage-title">
        <h1 className="pb-title" id="pb-manage-title">Vaš termin</h1>
        <dl className="pb-details">
          <div><dt>Salon</dt><dd>{booking.salonName}</dd></div>
          <div><dt>Usluga</dt><dd>{booking.serviceName ?? "—"}</dd></div>
          <div><dt>Datum</dt><dd>{formatDateLong(getDateKeyInTimeZone(new Date(booking.startTime), booking.timeZone))}</dd></div>
          <div><dt>Vreme</dt><dd>{formatTimeRange(slot, booking.timeZone)}</dd></div>
          <div><dt>Status</dt><dd>{STATUS_LABELS[booking.status] ?? booking.status}</dd></div>
        </dl>

        {cancelState === "cancelled" && <p className="pb-notice" role="status">Termin je otkazan. Salon je obavešten.</p>}
        {cancelState === "already_cancelled" && <p className="pb-notice" role="status">Termin je već otkazan.</p>}
        {cancelState === "error" && <div className="pb-alert" role="alert">Otkazivanje trenutno nije uspelo. Pokušajte ponovo.</div>}

        {booking.status === "cancelled" && cancelState !== "cancelled" && cancelState !== "already_cancelled" && (
          <p className="pb-notice">Ovaj termin je otkazan.</p>
        )}
        {booking.status === "cancelled" && (
          <a className="pb-button-secondary" href={`/book/${encodeURIComponent(booking.salonSlug)}`}>Zakaži novi termin</a>
        )}

        {isActive && booking.canCancel && (
          <>
            <p className="pb-notice">Online otkazivanje je moguće do: {formatDeadline(booking.cancelDeadline, booking.timeZone)}.</p>
            {cancelState === "confirming" || cancelState === "cancelling" || cancelState === "error" ? (
              <div className="pb-confirm" role="alertdialog" aria-labelledby="pb-confirm-text">
                <p id="pb-confirm-text">Da li sigurno želite da otkažete ovaj termin?</p>
                <button type="button" className="pb-button pb-button-danger" disabled={cancelState === "cancelling"} aria-busy={cancelState === "cancelling"} onClick={() => void cancel()}>
                  {cancelState === "cancelling" ? "Otkazujem…" : "Da, otkaži termin"}
                </button>
                <button type="button" className="pb-button-secondary" disabled={cancelState === "cancelling"} onClick={() => setCancelState("idle")}>Ne, zadrži termin</button>
              </div>
            ) : (
              <button type="button" className="pb-button-secondary" onClick={() => setCancelState("confirming")}>Otkaži termin</button>
            )}
          </>
        )}

        {isActive && !booking.canCancel && (
          <p className="pb-notice" role={cancelState === "too_late" ? "alert" : undefined}>
            Online otkazivanje je moguće najkasnije 2 sata pre početka termina. Za otkazivanje ili izmenu<SalonContact phone={phone} />
          </p>
        )}
        {!isActive && booking.status !== "cancelled" && (
          <p className="pb-notice">Ovaj termin više nije moguće otkazati online. Za pitanja<SalonContact phone={phone} /></p>
        )}
      </section>
      <PublicBookingFooter />
    </div>
  );
}
