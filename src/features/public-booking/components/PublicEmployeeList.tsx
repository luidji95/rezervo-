import type {
  PublicEmployee,
  PublicEmployeeSelection,
} from "../types";

type PublicEmployeeListProps = {
  employees: PublicEmployee[];
  disabled?: boolean;
  error: boolean;
  loading: boolean;
  selectedEmployeeId: PublicEmployeeSelection;
  onSelectEmployee: (employeeId: PublicEmployeeSelection) => void;
};

function safeImageUrl(value: string | null): string | null {
  if (!value) return null;

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function getInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

export function PublicEmployeeList({
  employees,
  disabled = false,
  error,
  loading,
  selectedEmployeeId,
  onSelectEmployee,
}: PublicEmployeeListProps) {
  return (
    <section className="public-employees-section" aria-busy={loading}>
      <div className="public-section-heading">
        <p className="public-booking-eyebrow">Zaposleni</p>
        <h2>Izaberite zaposlenog</h2>
        <p>Izaberite osobu kod koje želite da zakažete termin.</p>
      </div>

      {loading && (
        <div className="public-inline-state" role="status">
          Učitavamo dostupne zaposlene...
        </div>
      )}

      {!loading && error && (
        <div className="public-inline-state public-inline-state-error" role="alert">
          Trenutno ne možemo da učitamo zaposlene. Pokušajte ponovo.
        </div>
      )}

      {!loading && !error && employees.length === 0 && (
        <div className="public-inline-state" role="status">
          Trenutno nema dostupnih zaposlenih za ovu uslugu.
        </div>
      )}

      {!loading && !error && employees.length > 0 && (
        <div className="public-employee-grid">
          {employees.map((employee) => {
            const avatarUrl = safeImageUrl(employee.avatarUrl);

            return (
              <button
                type="button"
                disabled={disabled}
                className="public-employee-card"
                aria-pressed={selectedEmployeeId === employee.id}
                key={employee.id}
                onClick={() => onSelectEmployee(employee.id)}
              >
                <span className="public-employee-avatar">
                  {avatarUrl ? (
                    // Employee-managed images can use different remote hosts.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={avatarUrl} alt="" />
                  ) : (
                    getInitials(employee.name)
                  )}
                </span>
                <span className="public-employee-copy">
                  <strong>{employee.name}</strong>
                  {employee.position && <small>{employee.position}</small>}
                  {employee.bio && <span>{employee.bio}</span>}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
