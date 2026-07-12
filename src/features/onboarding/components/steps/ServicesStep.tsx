import type { FormEvent } from "react";

import type { OnboardingServiceItem } from "../../types/onboarding";

type ServicesStepProps = {
  isSavingServices: boolean;
  serviceItems: OnboardingServiceItem[];
  serviceValidationError: string | null;
  onAddService: () => void;
  onApplyTemplate: () => void;
  onRemoveService: (index: number) => void;
  onSave: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onUpdateService: (
    index: number,
    values: Partial<OnboardingServiceItem>
  ) => void;
};

export function ServicesStep({
  isSavingServices,
  serviceItems,
  serviceValidationError,
  onAddService,
  onApplyTemplate,
  onRemoveService,
  onSave,
  onUpdateService,
}: ServicesStepProps) {
  return (
    <form className="onboarding-form" onSubmit={onSave}>
      <h2>Usluge</h2>

      <div className="onboarding-chip-row">
        <button
          className="onboarding-secondary-btn"
          type="button"
          onClick={onApplyTemplate}
        >
          Koristi template
        </button>
        <button
          className="onboarding-secondary-btn"
          type="button"
          onClick={onAddService}
        >
          + Dodaj uslugu
        </button>
      </div>

      {serviceValidationError && (
        <p className="onboarding-error">{serviceValidationError}</p>
      )}

      {serviceItems.map((service, index) => (
        <fieldset
          className="onboarding-item-card onboarding-service-card"
          key={service.rowKey}
        >
          <legend>Usluga {index + 1}</legend>

          <div className="onboarding-field">
            <label htmlFor={`serviceName-${service.rowKey}`}>
              Naziv usluge
            </label>
            <input
              id={`serviceName-${service.rowKey}`}
              type="text"
              value={service.name}
              onChange={(event) =>
                onUpdateService(index, { name: event.target.value })
              }
            />
          </div>

          <div className="onboarding-field">
            <label htmlFor={`serviceDuration-${service.rowKey}`}>
              Trajanje u minutima
            </label>
            <input
              id={`serviceDuration-${service.rowKey}`}
              min={5}
              step={5}
              type="number"
              value={service.durationMinutes}
              onChange={(event) =>
                onUpdateService(index, {
                  durationMinutes: event.target.valueAsNumber,
                })
              }
            />
          </div>

          <div className="onboarding-field">
            <label htmlFor={`servicePrice-${service.rowKey}`}>Cena</label>
            <input
              id={`servicePrice-${service.rowKey}`}
              min={0}
              step={100}
              type="number"
              value={service.priceAmount}
              onChange={(event) =>
                onUpdateService(index, {
                  priceAmount: event.target.valueAsNumber,
                })
              }
            />
          </div>

          <button
            className="onboarding-danger-btn"
            type="button"
            onClick={() => onRemoveService(index)}
            disabled={serviceItems.length === 1}
          >
            Obriši uslugu
          </button>
        </fieldset>
      ))}

      <div className="onboarding-actions">
        <button
          className="onboarding-primary-btn"
          type="submit"
          disabled={isSavingServices}
        >
          {isSavingServices ? "Čuvam..." : "Sačuvaj i nastavi"}
        </button>
      </div>
    </form>
  );
}

