import type {
  PublicAvailabilitySlot,
  PublicCustomerData,
  PublicEmployee,
  PublicService,
} from "../types";

type PublicBookingSummaryProps = {
  customer: PublicCustomerData;
  date: string;
  employee: PublicEmployee;
  salonName: string;
  service: PublicService;
  slot: PublicAvailabilitySlot;
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("sr-RS", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Belgrade",
  }).format(new Date(`${value}T12:00:00Z`));
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("sr-RS", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Belgrade",
  }).format(new Date(value));
}

function formatPrice(price: number, currency: string) {
  try {
    return new Intl.NumberFormat("sr-RS", {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(price);
  } catch {
    return `${price.toLocaleString("sr-RS")} ${currency}`;
  }
}

export function PublicBookingSummary({
  customer,
  date,
  employee,
  salonName,
  service,
  slot,
}: PublicBookingSummaryProps) {
  return (
    <div className="public-booking-summary">
      <h3>Pregled rezervacije</h3>
      <dl>
        <div><dt>Salon</dt><dd>{salonName}</dd></div>
        <div><dt>Usluga</dt><dd>{service.name}</dd></div>
        <div><dt>Zaposleni</dt><dd>{employee.name}</dd></div>
        <div><dt>Datum</dt><dd>{formatDate(date)}</dd></div>
        <div><dt>Vreme</dt><dd>{formatTime(slot.startTime)}</dd></div>
        <div><dt>Trajanje</dt><dd>{service.durationMinutes} min</dd></div>
        <div><dt>Cena</dt><dd>{formatPrice(service.price, service.currency)}</dd></div>
        <div><dt>Klijent</dt><dd>{customer.fullName || "—"}</dd></div>
        {customer.phone && <div><dt>Telefon</dt><dd>{customer.phone}</dd></div>}
        {customer.email && <div><dt>Email</dt><dd>{customer.email}</dd></div>}
      </dl>
    </div>
  );
}
