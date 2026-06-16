"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  Info,
  Mail,
  MoreVertical,
  ShieldCheck,
  UserPlus,
  Users,
  X,
} from "lucide-react";

import { useSalon } from "@/context/SalonContext";
import { getSalonEmployees } from "@/services/employeeService";
import { getSalonMembers } from "@/services/teamService";
import type { Employee } from "@/types/employee";
import type { SalonMember, TeamRole } from "@/types/team";

const ROLE_LABELS: Record<TeamRole, string> = {
  owner: "Owner",
  manager: "Manager",
  receptionist: "Receptionist",
  employee: "Employee",
};

const ROLE_OPTIONS: TeamRole[] = [
  "owner",
  "manager",
  "receptionist",
  "employee",
];

const MODULES = [
  "Dashboard",
  "Kalendar",
  "Termini",
  "Klijenti",
  "Usluge",
  "Zaposleni",
  "Inbox",
  "Marketing",
  "Statistika",
  "Podešavanja",
];

const ROLE_ACCESS: Record<TeamRole, string[]> = {
  owner: MODULES,
  manager: [
    "Dashboard",
    "Kalendar",
    "Termini",
    "Klijenti",
    "Usluge",
    "Zaposleni",
    "Inbox",
    "Marketing",
    "Statistika",
  ],
  receptionist: ["Kalendar", "Termini", "Klijenti", "Inbox"],
  employee: ["Kalendar", "Termini"],
};

function normalizeRole(role?: string | null): TeamRole {
  if (role === "owner") return "owner";
  if (role === "manager") return "manager";
  if (role === "receptionist") return "receptionist";
  return "employee";
}

function getEmployeeName(employee: Employee) {
  return employee.display_name || employee.full_name;
}

function getEmployeeContact(employee: Employee) {
  return employee.email || employee.phone || "Nema kontakta";
}

function getEmployeeEmail(employee: Employee) {
  return employee.email || "Email nije dostupan";
}

function getMemberLabel(member: SalonMember, employees: Employee[]) {
  const employee = employees.find(
    (item) => item.profile_id && item.profile_id === member.profile_id
  );

  if (employee) return getEmployeeName(employee);

  if (member.role === "owner") return "Vlasnik salona";

  return "Član aplikacije";
}

function getMemberContact(member: SalonMember, employees: Employee[]) {
  const employee = employees.find(
    (item) => item.profile_id && item.profile_id === member.profile_id
  );

  return employee ? getEmployeeEmail(employee) : "Email nije dostupan";
}

export default function TeamManager() {
  const { currentSalon, salonLoading } = useSalon();

  const [members, setMembers] = useState<SalonMember[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRole, setSelectedRole] = useState<TeamRole>("owner");
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [message, setMessage] = useState("");

  const salonId = currentSalon?.id;

  useEffect(() => {
    if (!salonId) return;

    let ignore = false;

    async function loadTeamData() {
      try {
        setLoading(true);

        const [membersData, employeesData] = await Promise.all([
          getSalonMembers(salonId),
          getSalonEmployees(salonId),
        ]);

        if (!ignore) {
          setMembers(membersData);
          setEmployees(employeesData);
        }
      } catch (error) {
        console.error("Greška pri učitavanju tima:", error);
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    loadTeamData();

    return () => {
      ignore = true;
    };
  }, [salonId]);

  const employeesWithoutAccess = useMemo(() => {
    const memberProfileIds = new Set(
      members.map((member) => member.profile_id).filter(Boolean)
    );

    return employees.filter(
      (employee) =>
        !employee.profile_id || !memberProfileIds.has(employee.profile_id)
    );
  }, [employees, members]);

  if (salonLoading || loading) {
    return (
      <div className="settings-card">
        <p>Učitavanje tima i dozvola...</p>
      </div>
    );
  }

  if (!currentSalon || !salonId) {
    return (
      <div className="settings-card">
        <p className="settings-error-text">Salon nije pronađen.</p>
      </div>
    );
  }

  return (
    <div className="team-settings-layout">
      <div className="team-left-column">
        <section className="settings-card">
          <div className="settings-card-header">
            <div>
              <h3>Članovi aplikacije</h3>
              <p>Ljudi koji imaju login pristup Rezervo aplikaciji.</p>
            </div>

            <button
              type="button"
              className="settings-primary-btn team-add-btn"
              onClick={() => {
                setMessage("");
                setIsInviteOpen(true);
              }}
            >
              <UserPlus size={16} />
              Dodaj člana tima
            </button>
          </div>

          <div className="team-table">
            <div className="team-table-head">
              <span>Ime</span>
              <span>Email</span>
              <span>Uloga</span>
              <span>Status</span>
              <span>Pristup</span>
              <span>Akcije</span>
            </div>

            {members.length === 0 ? (
              <div className="team-empty-state">
                <Users size={22} />
                <p>Nema dodatih članova aplikacije.</p>
              </div>
            ) : (
              members.map((member) => {
                const role = normalizeRole(member.role);

                return (
                  <div key={member.id} className="team-table-row">
                    <strong>{getMemberLabel(member, employees)}</strong>
                    <span>{getMemberContact(member, employees)}</span>
                    <span className="team-role-pill">{ROLE_LABELS[role]}</span>
                    <span className="team-status-pill">
                      {member.status === "active" ? "Aktivan" : member.status}
                    </span>
                    <span>{role === "owner" ? "Svi moduli" : "Po ulozi"}</span>
                    <button
                      type="button"
                      className="team-icon-btn"
                      aria-label="Izmeni člana"
                    >
                      <MoreVertical size={16} />
                    </button>
                  </div>
                );
              })
            )}
          </div>

          {message && <p className="settings-save-message standalone">{message}</p>}
        </section>

        <section className="settings-card">
          <div className="settings-card-header">
            <div>
              <h3>Zaposleni bez pristupa</h3>
              <p>Radnici iz operativnog tima koji još nemaju login nalog.</p>
            </div>
          </div>

          <div className="team-worker-list">
            {employeesWithoutAccess.length === 0 ? (
              <div className="team-empty-state compact">
                <ShieldCheck size={22} />
                <p>Svi povezani zaposleni već imaju aplikacioni pristup.</p>
              </div>
            ) : (
              employeesWithoutAccess.map((employee) => (
                <div key={employee.id} className="team-worker-row">
                  <div>
                    <strong>{getEmployeeName(employee)}</strong>
                    <span>{getEmployeeContact(employee)}</span>
                  </div>

                  <span>{employee.position || "Zaposleni"}</span>

                  <button
                    type="button"
                    className="settings-secondary-btn"
                    onClick={() => {
                      setMessage("");
                      setIsInviteOpen(true);
                    }}
                  >
                    Pozovi u tim
                  </button>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      <aside className="team-right-column">
        <section className="settings-card">
          <div className="settings-card-header">
            <div>
              <h3>Dozvole uloga</h3>
              <p>Sistemski pregled pristupa po ulozi za V1.</p>
            </div>
          </div>

          <label className="team-role-select">
            <span>Uloga</span>
            <select
              value={selectedRole}
              onChange={(event) =>
                setSelectedRole(event.target.value as TeamRole)
              }
            >
              {ROLE_OPTIONS.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </select>
            <ChevronDown size={15} />
          </label>

          <div className="team-permission-list">
            {MODULES.map((module) => {
              const allowed = ROLE_ACCESS[selectedRole].includes(module);

              return (
                <div key={module} className="team-permission-row">
                  <span>{module}</span>
                  <strong className={allowed ? "allowed" : "blocked"}>
                    {allowed ? (
                      <>
                        <Check size={15} />
                        Dozvoljeno
                      </>
                    ) : (
                      <>
                        <X size={15} />
                        Ograničeno
                      </>
                    )}
                  </strong>
                </div>
              );
            })}
          </div>

          <div className="team-info-box">
            <Info size={17} />
            <p>
              Ove dozvole su trenutno sistemske po ulozi. Granularno
              uređivanje dozvola biće dostupno kasnije.
            </p>
          </div>
        </section>

        <section className="settings-card">
          <div className="team-how-card">
            <Mail size={18} />
            <div>
              <h3>Kako funkcioniše?</h3>
              <p>
                Članovi aplikacije dolaze iz `salon_members` i imaju login
                pristup. Zaposleni mogu postojati u salonu bez Rezervo naloga.
              </p>
            </div>
          </div>
        </section>
      </aside>

      {isInviteOpen && (
        <InviteMemberModal
          employees={employeesWithoutAccess}
          onClose={() => setIsInviteOpen(false)}
          onSubmit={() => {
            setIsInviteOpen(false);
            setMessage(
              "Pozivnice za članove tima biće omogućene u sledećem koraku."
            );
          }}
        />
      )}
    </div>
  );
}

function InviteMemberModal({
  employees,
  onClose,
  onSubmit,
}: {
  employees: Employee[];
  onClose: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="team-modal-backdrop">
      <div className="team-modal">
        <div className="team-modal-header">
          <div>
            <h3>Dodaj člana tima</h3>
            <p>Invite flow je pripremljen kao V1 placeholder.</p>
          </div>

          <button type="button" onClick={onClose} aria-label="Zatvori">
            <X size={18} />
          </button>
        </div>

        <div className="team-modal-form">
          <label>
            <span>Izaberite zaposlenog</span>
            <select>
              <option value="">Izaberite zaposlenog</option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {getEmployeeName(employee)}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Email za pristup</span>
            <input type="email" placeholder="ime@email.com" />
          </label>

          <label>
            <span>Uloga</span>
            <select defaultValue="employee">
              {ROLE_OPTIONS.filter((role) => role !== "owner").map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </select>
          </label>

          <div className="team-modal-note">
            Pozivnice za članove tima biće omogućene u sledećem koraku.
          </div>
        </div>

        <div className="team-modal-actions">
          <button type="button" className="settings-secondary-btn" onClick={onClose}>
            Otkaži
          </button>
          <button type="button" className="settings-primary-btn" onClick={onSubmit}>
            Pošalji pozivnicu
          </button>
        </div>
      </div>
    </div>
  );
}
