import type { PublicService } from "../types";

type PublicServiceListProps = {
  services: PublicService[];
  disabled?: boolean;
  selectedServiceId: string | null;
  onSelectService: (serviceId: string | null) => void;
};

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

export function PublicServiceList({
  services,
  disabled = false,
  selectedServiceId,
  onSelectService,
}: PublicServiceListProps) {
  if (services.length === 0) {
    return (
      <section className="public-services-section">
        <div className="public-section-heading">
          <p className="public-booking-eyebrow">Usluge</p>
          <h2>Izaberite uslugu</h2>
        </div>
        <div className="public-booking-state public-booking-state-compact">
          <h3>Trenutno nema dostupnih usluga</h3>
          <p>Salon još nema objavljene usluge za online rezervaciju.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="public-services-section">
      <div className="public-section-heading">
        <p className="public-booking-eyebrow">Usluge</p>
        <h2>Izaberite uslugu</h2>
        <p>Izaberite uslugu da biste nastavili na izbor zaposlenog i termina.</p>
      </div>

      <div className="public-service-grid">
        {services.map((service) => {
          const isSelected = selectedServiceId === service.id;

          return (
            <article
              className={`public-service-card${isSelected ? " is-selected" : ""}`}
              key={service.id}
            >
              <div className="public-service-content">
                <h3>{service.name}</h3>
                {service.description && <p>{service.description}</p>}
                <div className="public-service-meta">
                  <span>{service.durationMinutes} min</span>
                  <strong>{formatPrice(service.price, service.currency)}</strong>
                </div>
              </div>

              <button
                type="button"
                disabled={disabled}
                className="public-service-button"
                aria-pressed={isSelected}
                onClick={() => onSelectService(isSelected ? null : service.id)}
              >
                {isSelected ? "Izabrano" : "Izaberi uslugu"}
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}
