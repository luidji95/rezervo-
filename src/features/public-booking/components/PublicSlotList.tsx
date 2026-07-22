import type { PublicAvailabilitySlot } from "../types";

type PublicSlotListProps = {
  error: boolean;
  disabled?: boolean;
  loading: boolean;
  selectedSlot: PublicAvailabilitySlot | null;
  slots: PublicAvailabilitySlot[];
  onSelectSlot: (slot: PublicAvailabilitySlot) => void;
};

function formatSlotTime(value: string) {
  return new Intl.DateTimeFormat("sr-RS", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Belgrade",
  }).format(new Date(value));
}

export function PublicSlotList({
  error,
  disabled = false,
  loading,
  selectedSlot,
  slots,
  onSelectSlot,
}: PublicSlotListProps) {
  return (
    <section className="public-slots-section" aria-busy={loading}>
      <div className="public-section-heading">
        <p className="public-booking-eyebrow">Vreme</p>
        <h2>Izaberite vreme</h2>
      </div>

      {loading && (
        <div className="public-inline-state" role="status">
          Učitavamo slobodne termine...
        </div>
      )}

      {!loading && error && (
        <div className="public-inline-state public-inline-state-error" role="alert">
          Slobodni termini trenutno nisu dostupni. Pokušajte ponovo.
        </div>
      )}

      {!loading && !error && slots.length === 0 && (
        <div className="public-inline-state" role="status">
          Nema slobodnih termina za izabrani datum.
        </div>
      )}

      {!loading && !error && slots.length > 0 && (
        <div className="public-slot-grid">
          {slots.map((slot) => {
            const isSelected = selectedSlot?.startTime === slot.startTime;

            return (
              <button
                type="button"
                disabled={disabled || loading}
                className="public-slot-button"
                aria-pressed={isSelected}
                key={`${slot.employeeId}-${slot.startTime}`}
                onClick={() => onSelectSlot(slot)}
              >
                {formatSlotTime(slot.startTime)}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
