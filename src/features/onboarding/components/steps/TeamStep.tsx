import type { FormEvent } from "react";

import type {
  OnboardingEmployeeItem,
  TeamMode,
} from "../../types/onboarding";

type TeamStepProps = {
  employeeItems: OnboardingEmployeeItem[];
  isSavingTeam: boolean;
  teamMode: TeamMode;
  teamValidationError: string | null;
  onAddEmployee: () => void;
  onRemoveEmployee: (index: number) => void;
  onSave: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onSetTeamMode: (mode: TeamMode) => void;
  onSetTeamValidationError: (error: string | null) => void;
  onUpdateEmployee: (
    index: number,
    values: Partial<OnboardingEmployeeItem>
  ) => void;
};

export function TeamStep({
  employeeItems,
  isSavingTeam,
  teamMode,
  teamValidationError,
  onAddEmployee,
  onRemoveEmployee,
  onSave,
  onSetTeamMode,
  onSetTeamValidationError,
  onUpdateEmployee,
}: TeamStepProps) {
  return (
    <form className="onboarding-form" onSubmit={onSave}>
      <h2>Tim</h2>

      <div className="onboarding-choice-grid">
        <label
          className={`onboarding-choice-card ${
            teamMode === "solo" ? "active" : ""
          }`}
        >
          <input
            checked={teamMode === "solo"}
            name="teamMode"
            type="radio"
            value="solo"
            onChange={() => {
              onSetTeamMode("solo");
              onSetTeamValidationError(null);
            }}
          />
          <span>
            <strong>Samo ja</strong>
            <small>Jedan zaposleni, vlasnik salona.</small>
          </span>
        </label>

        <label
          className={`onboarding-choice-card ${
            teamMode === "team" ? "active" : ""
          }`}
        >
          <input
            checked={teamMode === "team"}
            name="teamMode"
            type="radio"
            value="team"
            onChange={() => {
              onSetTeamMode("team");
              onSetTeamValidationError(null);
            }}
          />
          <span>
            <strong>Imam tim</strong>
            <small>Dodajte zaposlene koji rade termine.</small>
          </span>
        </label>
      </div>

      {teamMode === "solo" && (
        <p className="onboarding-muted-box">
          Kreiraćemo jednog zaposlenog za salon sa pozicijom Vlasnik, bez
          dupliranja ako već postoji.
        </p>
      )}

      {teamMode === "team" && (
        <>
          <button
            className="onboarding-secondary-btn"
            type="button"
            onClick={onAddEmployee}
          >
            + Dodaj zaposlenog
          </button>

          {teamValidationError && (
            <p className="onboarding-error">{teamValidationError}</p>
          )}

          {employeeItems.map((employee, index) => (
            <fieldset
              className="onboarding-item-card onboarding-employee-card"
              key={employee.rowKey}
            >
              <legend>Zaposleni {index + 1}</legend>

              <div className="onboarding-field">
                <label htmlFor={`employeeName-${employee.rowKey}`}>Ime</label>
                <input
                  id={`employeeName-${employee.rowKey}`}
                  type="text"
                  value={employee.fullName}
                  onChange={(event) =>
                    onUpdateEmployee(index, {
                      fullName: event.target.value,
                    })
                  }
                />
              </div>

              <div className="onboarding-field">
                <label htmlFor={`employeePosition-${employee.rowKey}`}>
                  Pozicija
                </label>
                <input
                  id={`employeePosition-${employee.rowKey}`}
                  type="text"
                  value={employee.position}
                  onChange={(event) =>
                    onUpdateEmployee(index, {
                      position: event.target.value,
                    })
                  }
                />
              </div>

              <div className="onboarding-field">
                <label htmlFor={`employeePhone-${employee.rowKey}`}>
                  Telefon
                </label>
                <input
                  id={`employeePhone-${employee.rowKey}`}
                  type="text"
                  value={employee.phone}
                  onChange={(event) =>
                    onUpdateEmployee(index, {
                      phone: event.target.value,
                    })
                  }
                />
              </div>

              <div className="onboarding-field">
                <label htmlFor={`employeeEmail-${employee.rowKey}`}>
                  Email
                </label>
                <input
                  id={`employeeEmail-${employee.rowKey}`}
                  type="email"
                  value={employee.email}
                  onChange={(event) =>
                    onUpdateEmployee(index, {
                      email: event.target.value,
                    })
                  }
                />
              </div>

              <button
                className="onboarding-danger-btn"
                type="button"
                onClick={() => onRemoveEmployee(index)}
                disabled={employeeItems.length === 1}
              >
                Ukloni zaposlenog
              </button>
            </fieldset>
          ))}
        </>
      )}

      {teamMode === "solo" && teamValidationError && (
        <p className="onboarding-error">{teamValidationError}</p>
      )}

      <div className="onboarding-actions">
        <button
          className="onboarding-primary-btn"
          type="submit"
          disabled={isSavingTeam}
        >
          {isSavingTeam ? "Čuvam..." : "Sačuvaj i nastavi"}
        </button>
      </div>
    </form>
  );
}

