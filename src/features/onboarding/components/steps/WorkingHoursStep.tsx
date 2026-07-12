import type { FormEvent } from "react";

import type { WorkingHourFormDay } from "../../types/onboarding";

type WorkingHoursStepProps = {
  isSavingWorkingHours: boolean;
  isSkippingSetup: boolean;
  workingHourDays: WorkingHourFormDay[];
  onApplyTemplate: (opensAt: string, closesAt: string) => void;
  onSave: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onSkipSetup: () => Promise<void>;
  onUpdateDay: (index: number, values: Partial<WorkingHourFormDay>) => void;
};

export function WorkingHoursStep({
  isSavingWorkingHours,
  isSkippingSetup,
  workingHourDays,
  onApplyTemplate,
  onSave,
  onSkipSetup,
  onUpdateDay,
}: WorkingHoursStepProps) {
  return (
    <form className="onboarding-form" onSubmit={onSave}>
      <h2>Radno vreme</h2>

      <div className="onboarding-chip-row">
        <button
          className="onboarding-chip-btn"
          type="button"
          onClick={() => onApplyTemplate("09:00", "17:00")}
        >
          09-17
        </button>
        <button
          className="onboarding-chip-btn"
          type="button"
          onClick={() => onApplyTemplate("10:00", "18:00")}
        >
          10-18
        </button>
        <button
          className="onboarding-chip-btn"
          type="button"
          onClick={() => onApplyTemplate("12:00", "20:00")}
        >
          12-20
        </button>
      </div>

      {workingHourDays.map((day, index) => (
        <fieldset
          className={`onboarding-working-row ${
            !day.isWorkingDay ? "is-disabled" : ""
          }`}
          key={day.dayOfWeek}
        >
          <legend>{day.label}</legend>

          <label className="onboarding-toggle-row">
            <input
              checked={day.isWorkingDay}
              type="checkbox"
              onChange={(event) =>
                onUpdateDay(index, {
                  isWorkingDay: event.target.checked,
                })
              }
            />
            Radi
          </label>

          <div className="onboarding-field">
            <label htmlFor={`opensAt-${day.dayOfWeek}`}>Početak</label>
            <input
              id={`opensAt-${day.dayOfWeek}`}
              disabled={!day.isWorkingDay}
              type="time"
              value={day.opensAt}
              onChange={(event) =>
                onUpdateDay(index, {
                  opensAt: event.target.value,
                })
              }
            />
          </div>

          <div className="onboarding-field">
            <label htmlFor={`closesAt-${day.dayOfWeek}`}>Kraj</label>
            <input
              id={`closesAt-${day.dayOfWeek}`}
              disabled={!day.isWorkingDay}
              type="time"
              value={day.closesAt}
              onChange={(event) =>
                onUpdateDay(index, {
                  closesAt: event.target.value,
                })
              }
            />
          </div>

          <div className="onboarding-field">
            <label htmlFor={`breakStartsAt-${day.dayOfWeek}`}>Pauza od</label>
            <input
              id={`breakStartsAt-${day.dayOfWeek}`}
              disabled={!day.isWorkingDay}
              type="time"
              value={day.breakStartsAt}
              onChange={(event) =>
                onUpdateDay(index, {
                  breakStartsAt: event.target.value,
                })
              }
            />
          </div>

          <div className="onboarding-field">
            <label htmlFor={`breakEndsAt-${day.dayOfWeek}`}>Pauza do</label>
            <input
              id={`breakEndsAt-${day.dayOfWeek}`}
              disabled={!day.isWorkingDay}
              type="time"
              value={day.breakEndsAt}
              onChange={(event) =>
                onUpdateDay(index, {
                  breakEndsAt: event.target.value,
                })
              }
            />
          </div>
        </fieldset>
      ))}

      <div className="onboarding-actions">
        <button
          className="onboarding-primary-btn"
          type="submit"
          disabled={isSavingWorkingHours}
        >
          {isSavingWorkingHours ? "Čuvam..." : "Sačuvaj i nastavi"}
        </button>

        <button
          className="onboarding-secondary-btn"
          type="button"
          onClick={onSkipSetup}
          disabled={isSkippingSetup}
        >
          {isSkippingSetup
            ? "Preusmeravam..."
            : "Preskoči setup i idi na dashboard"}
        </button>
      </div>
    </form>
  );
}

