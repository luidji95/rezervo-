type FinishStepProps = {
  employeesCount: number;
  hasWorkingHours: boolean;
  isLoading: boolean;
  salonName: string;
  salonSlug: string | null;
  servicesCount: number;
  onBack: () => void;
  onGoToCalendar: () => void;
  onGoToDashboard: () => void;
};

export function FinishStep({
  employeesCount,
  hasWorkingHours,
  isLoading,
  salonName,
  salonSlug,
  servicesCount,
  onBack,
  onGoToCalendar,
  onGoToDashboard,
}: FinishStepProps) {
  return (
    <section className="onboarding-finish">
      <h2>🎉 Vaš salon je spreman.</h2>
      <p>
        Uspešno ste završili početno podešavanje. Sve osnovne informacije su
        sačuvane i možete odmah početi da koristite Rezervo.
      </p>

      <div className="onboarding-summary-grid">
        <article className="onboarding-summary-card">
          <h3>Naziv salona</h3>
          <p>{salonName || "Salon"}</p>
        </article>

        <article className="onboarding-summary-card">
          <h3>Broj zaposlenih</h3>
          <p>{employeesCount}</p>
        </article>

        <article className="onboarding-summary-card">
          <h3>Broj usluga</h3>
          <p>{servicesCount}</p>
        </article>

        <article className="onboarding-summary-card">
          <h3>Radno vreme podešeno</h3>
          <p>{hasWorkingHours ? "✓" : "Nije podešeno"}</p>
        </article>
      </div>

      <div className="onboarding-action-grid">
        <button
          className="onboarding-action-card"
          type="button"
          onClick={onGoToDashboard}
          disabled={isLoading}
        >
          <strong>Idi na Dashboard</strong>
          <span>Otvori glavni pregled i počni sa radom.</span>
        </button>

        <button
          className="onboarding-action-card"
          type="button"
          onClick={onGoToCalendar}
          disabled={isLoading}
        >
          <strong>Dodaj prvi termin</strong>
          <span>Brzo kreiraj prvu rezervaciju.</span>
        </button>

        <button className="onboarding-action-card" type="button" disabled>
          <strong>Booking link</strong>
          <span>{salonSlug ? `/book/${salonSlug}` : "Uskoro dostupno"}</span>
          <span>Uskoro dostupno</span>
        </button>
      </div>

      <div className="onboarding-actions">
        <button
          className="onboarding-secondary-btn"
          type="button"
          onClick={onBack}
        >
          Nazad
        </button>

        <button
          className="onboarding-primary-btn"
          type="button"
          onClick={onGoToDashboard}
          disabled={isLoading}
        >
          {isLoading ? "Preusmeravam..." : "Idi na Dashboard"}
        </button>
      </div>
    </section>
  );
}

