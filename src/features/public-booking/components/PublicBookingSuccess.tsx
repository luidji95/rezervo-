import { Check } from "lucide-react";
import { formatDateLong, formatTimeRange } from "../publicBookingFormat";
import type { PublicAvailabilitySlot, PublicEmployee, PublicService } from "../types";
import { PublicManageLink } from "./PublicManageLink";

type PublicBookingSuccessProps = {
  date: string;
  employee: PublicEmployee;
  manageToken: string | null;
  salonName: string;
  service: PublicService;
  slot: PublicAvailabilitySlot;
  timeZone: string;
  onBookAnother: () => void;
};

// Rendered only after the server confirmed the booking (201 or an idempotent 200 replay).
export function PublicBookingSuccess({ date, employee, manageToken, salonName, service, slot, timeZone, onBookAnother }: PublicBookingSuccessProps) {
  return (
    <section className="pb-step pb-success" role="status" aria-labelledby="pb-success-title">
      <div className="pb-success-mark" aria-hidden="true"><span><Check size={30} strokeWidth={3} /></span></div>
      <h1 className="pb-title" id="pb-success-title">Termin je zakazan</h1>
      <p className="pb-lead">Salon je primio vaš termin.</p>
      <dl className="pb-details">
        <div><dt>Salon</dt><dd>{salonName}</dd></div>
        <div><dt>Usluga</dt><dd>{service.name}</dd></div>
        <div><dt>Zaposleni</dt><dd>{employee.name}</dd></div>
        <div><dt>Datum</dt><dd>{formatDateLong(date)}</dd></div>
        <div><dt>Vreme</dt><dd>{formatTimeRange(slot, timeZone)}</dd></div>
      </dl>
      {manageToken && <PublicManageLink token={manageToken} />}
      <button type="button" className="pb-button-secondary" onClick={onBookAnother}>Zakaži još jedan termin</button>
    </section>
  );
}
