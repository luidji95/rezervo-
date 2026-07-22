import type {
  PublicAvailabilitySlot,
  PublicBookingResult,
  PublicEmployee,
  PublicService,
} from "../types";

type PublicBookingSuccessProps = {
  date: string;
  employee: PublicEmployee;
  result: PublicBookingResult;
  salonName: string;
  service: PublicService;
  slot: PublicAvailabilitySlot;
  onBookAnother: () => void;
};

function formatDateTime(date: string, startTime: string) {
  const formattedDate = new Intl.DateTimeFormat("sr-RS", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Belgrade",
  }).format(new Date(`${date}T12:00:00Z`));
  const formattedTime = new Intl.DateTimeFormat("sr-RS", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Belgrade",
  }).format(new Date(startTime));

  return `${formattedDate} u ${formattedTime}`;
}

export function PublicBookingSuccess({
  date,
  employee,
  result,
  salonName,
  service,
  slot,
  onBookAnother,
}: PublicBookingSuccessProps) {
  return (
    <section className="public-booking-success" role="status">
      <div className="public-booking-success-mark" aria-hidden="true">✓</div>
      <p className="public-booking-eyebrow">Rezervacija potvrđena</p>
      <h2>Termin je uspešno rezervisan.</h2>
      <dl>
        <div><dt>Salon</dt><dd>{salonName}</dd></div>
        <div><dt>Usluga</dt><dd>{service.name}</dd></div>
        <div><dt>Zaposleni</dt><dd>{employee.name}</dd></div>
        <div><dt>Termin</dt><dd>{formatDateTime(date, slot.startTime)}</dd></div>
        <div><dt>Trajanje</dt><dd>{service.durationMinutes} min</dd></div>
        <div><dt>Klijent</dt><dd>{result.customer.fullName}</dd></div>
      </dl>
      <div className="public-booking-success-actions">
        <a href="#public-salon-profile" className="public-booking-secondary-action">
          Nazad na profil salona
        </a>
        <button
          type="button"
          className="public-booking-submit"
          onClick={onBookAnother}
        >
          Zakaži još jedan termin
        </button>
      </div>
    </section>
  );
}
