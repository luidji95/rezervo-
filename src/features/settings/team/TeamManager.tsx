"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import {
  BadgeCheck,
  BriefcaseBusiness,
  ShieldCheck,
  UserRound,
  Users,
} from "lucide-react";

import { useSalon } from "@/context/SalonContext";
import { useAuthorization } from "@/context/AuthorizationContext";
import { useAuth } from "@/context/AuthContext";
import {
  getSalonEmployees,
  linkEmployeeToCurrentOwner,
  OwnerEmployeeAlreadyLinkedError,
} from "@/services/employeeService";
import { getSalonMembers, getTeamProfiles } from "@/services/teamService";
import {
  getTeamInvitations,
  sendTeamInvitation,
  SendInvitationError,
  type TeamInvitationSummary,
} from "@/services/teamInvitationService";
import type { Employee } from "@/types/employee";
import type { SalonMember, TeamProfile } from "@/types/team";
import TeamInviteModal from "./TeamInviteModal";

function getEmployeeName(employee: Employee) {
  return employee.display_name || employee.full_name;
}

function getProfileName(profile: TeamProfile | undefined) {
  return profile?.full_name?.trim() || profile?.email || "Nepoznat korisnik";
}

function getStatusLabel(status?: string | null) {
  switch (status) {
    case "active":
      return "Aktivan";
    case "invited":
      return "Pozvan";
    case "inactive":
      return "Neaktivan";
    case "removed":
      return "Uklonjen";
    default:
      return status || "Članstvo nije pronađeno";
  }
}

function getMemberRoleLabel(member: SalonMember, ownerId: string) {
  if (member.profile_id === ownerId) return "Vlasnik";
  if (member.role === "employee") return "Zaposleni";
  if (member.role === "owner") return "Nevažeća owner veza";
  return member.role;
}

function getInvitationErrorMessage(code: string) {
  const messages: Record<string, string> = {
    UNAUTHORIZED: "Morate biti prijavljeni.",
    FORBIDDEN: "Nemate dozvolu da pozivate zaposlene.",
    INVALID_INPUT: "Proverite unete podatke.",
    EMPLOYEE_NOT_FOUND: "Zaposleni nije pronađen.",
    EMPLOYEE_ALREADY_LINKED: "Ovaj zaposleni već ima pristup aplikaciji.",
    ALREADY_INVITED: "Poziv je već poslat ovom zaposlenom.",
    ALREADY_MEMBER: "Ovaj korisnik je već član salona.",
    EMAIL_ALREADY_USED:
      "Ovaj email je već povezan sa drugim nalogom ili članstvom.",
    INVITE_FAILED: "Poziv trenutno nije moguće poslati. Pokušajte ponovo.",
  };
  return messages[code] ?? messages.INVITE_FAILED;
}

function ProfileAvatar({ profile }: { profile?: TeamProfile }) {
  if (profile?.avatar_url) {
    return (
      <Image
        className="team-person-avatar"
        src={profile.avatar_url}
        alt=""
        width={44}
        height={44}
        unoptimized
      />
    );
  }

  return (
    <span className="team-person-avatar team-person-avatar--fallback">
      <UserRound size={20} />
    </span>
  );
}

export default function TeamManager() {
  const { currentSalon, salonLoading } = useSalon();
  const { user, loading: authLoading } = useAuth();
  const { currentRole, loading: authorizationLoading } = useAuthorization();
  const [members, setMembers] = useState<SalonMember[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [profiles, setProfiles] = useState<TeamProfile[]>([]);
  const [invitations, setInvitations] = useState<TeamInvitationSummary[]>([]);
  const [invitationStatusesLoaded, setInvitationStatusesLoaded] = useState(false);
  const [invitationStatusError, setInvitationStatusError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [linkingEmployeeId, setLinkingEmployeeId] = useState<string | null>(null);
  const [linkMessage, setLinkMessage] = useState<string | null>(null);
  const [employeeToInvite, setEmployeeToInvite] = useState<Employee | null>(null);
  const [inviteMessage, setInviteMessage] = useState<string | null>(null);

  const salonId = currentSalon?.id;
  const ownerId = currentSalon?.owner_id;
  const userId = user?.id;

  useEffect(() => {
    if (authLoading || authorizationLoading) return;
    if (!userId || !salonId || !ownerId) return;

    let ignore = false;

    async function loadTeamData() {
      try {
        setLoading(true);
        setError(null);

        const [membersData, employeesData] = await Promise.all([
          getSalonMembers(salonId as string),
          getSalonEmployees(salonId as string),
        ]);
        const profileIds = [
          ownerId as string,
          ...membersData.map((member) => member.profile_id),
          ...employeesData.flatMap((employee) =>
            employee.profile_id ? [employee.profile_id] : [],
          ),
        ];
        const profilesData = await getTeamProfiles(profileIds);

        if (!ignore) {
          setMembers(membersData);
          setEmployees(employeesData);
          setProfiles(profilesData);
        }

        if (currentRole === "owner") {
          try {
            const invitationsData = await getTeamInvitations(salonId as string);
            if (!ignore) {
              setInvitations(invitationsData);
              setInvitationStatusesLoaded(true);
              setInvitationStatusError(null);
            }
          } catch (invitationError) {
            if (process.env.NODE_ENV === "development") {
              console.error("Invitation statuses failed to load", invitationError);
            }
            if (!ignore) {
              setInvitations([]);
              setInvitationStatusesLoaded(false);
              setInvitationStatusError(
                "Statusi poziva trenutno nisu dostupni.",
              );
            }
          }
        } else if (!ignore) {
          setInvitations([]);
          setInvitationStatusesLoaded(true);
          setInvitationStatusError(null);
        }
      } catch (teamError) {
        console.error("Greška pri učitavanju tima:", teamError);
        if (!ignore) {
          setError("Tim i dozvole trenutno nije moguće učitati.");
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    void loadTeamData();

    return () => {
      ignore = true;
    };
  }, [authLoading, authorizationLoading, currentRole, ownerId, salonId, userId]);

  const profilesById = useMemo(
    () => new Map(profiles.map((profile) => [profile.id, profile])),
    [profiles],
  );
  const membersByProfileId = useMemo(
    () => new Map(members.map((member) => [member.profile_id, member])),
    [members],
  );
  const employeesByProfileId = useMemo(
    () =>
      new Map(
        employees.flatMap((employee) =>
          employee.profile_id ? [[employee.profile_id, employee] as const] : [],
        ),
      ),
    [employees],
  );
  const invitationsByEmployeeId = useMemo(() => {
    const latestByEmployee = new Map<string, TeamInvitationSummary>();
    invitations.forEach((invitation) => {
      if (!latestByEmployee.has(invitation.employeeId)) {
        latestByEmployee.set(invitation.employeeId, invitation);
      }
    });
    return latestByEmployee;
  }, [invitations]);

  async function refreshInvitations() {
    if (!salonId || currentRole !== "owner") return false;
    try {
      setInvitations(await getTeamInvitations(salonId));
      setInvitationStatusesLoaded(true);
      setInvitationStatusError(null);
      return true;
    } catch (invitationError) {
      if (process.env.NODE_ENV === "development") {
        console.error("Invitation statuses failed to refresh", invitationError);
      }
      setInvitationStatusesLoaded(false);
      setInvitationStatusError(
        "Statusi poziva trenutno nisu dostupni.",
      );
      return false;
    }
  }

  async function handleInvite(email: string) {
    if (!salonId || !employeeToInvite || currentRole !== "owner") return;

    const invitedEmployee = employeeToInvite;
    try {
      await sendTeamInvitation({
        salonId,
        employeeId: invitedEmployee.id,
        email,
      });
      const now = new Date();
      setInvitations((current) => [
        {
          employeeId: invitedEmployee.id,
          email,
          status: "invited",
          createdAt: now.toISOString(),
          expiresAt: new Date(
            now.getTime() + 7 * 24 * 60 * 60 * 1000,
          ).toISOString(),
        },
        ...current.filter(
          (invitation) => invitation.employeeId !== invitedEmployee.id,
        ),
      ]);
      await refreshInvitations();
      setEmployeeToInvite(null);
      setInviteMessage(`Poziv je poslat na ${email}.`);
    } catch (inviteError) {
      if (
        inviteError instanceof SendInvitationError &&
        inviteError.code === "ALREADY_INVITED"
      ) {
        await refreshInvitations();
        setEmployeeToInvite(null);
        setInviteMessage("Poziv je već poslat ovom zaposlenom.");
        return;
      }

      throw new Error(
        inviteError instanceof SendInvitationError
          ? getInvitationErrorMessage(inviteError.code)
          : getInvitationErrorMessage("INVITE_FAILED"),
      );
    }
  }

  async function handleOwnerLink(employeeId: string) {
    if (!salonId || currentRole !== "owner") return;

    try {
      setLinkingEmployeeId(employeeId);
      setLinkMessage(null);
      const linkedEmployee = await linkEmployeeToCurrentOwner({
        employeeId,
        salonId,
      });

      setEmployees((currentEmployees) =>
        currentEmployees.map((employee) =>
          employee.id === linkedEmployee.id ? linkedEmployee : employee,
        ),
      );
      setLinkMessage("Zaposleni je povezan sa vašim owner nalogom.");
    } catch (linkError) {
      console.error("Owner/employee povezivanje nije uspelo:", linkError);
      setLinkMessage(
        linkError instanceof OwnerEmployeeAlreadyLinkedError
          ? "Owner nalog je već povezan sa drugim zaposlenim u ovom salonu."
          : linkError instanceof Error
            ? linkError.message
            : "Povezivanje trenutno nije moguće.",
      );
    } finally {
      setLinkingEmployeeId(null);
    }
  }

  if (salonLoading || loading) {
    return <div className="settings-card">Učitavanje tima i dozvola...</div>;
  }

  if (!currentSalon || !ownerId) {
    return <div className="settings-card settings-error-text">Salon nije pronađen.</div>;
  }

  if (error) {
    return <div className="settings-card settings-error-text">{error}</div>;
  }

  const ownerProfile = profilesById.get(ownerId);
  const ownerMembership = membersByProfileId.get(ownerId);
  const ownerEmployee = employeesByProfileId.get(ownerId);
  const applicationMembers = members.filter(
    (member) => member.profile_id !== ownerId,
  );

  return (
    <div className="team-concepts-layout">
      <section className="settings-card team-concept-section">
        <div className="settings-card-header">
          <div>
            <h3>Vlasnik salona</h3>
            <p>Owner nalog i puni administrativni pristup salonu.</p>
          </div>
          <span className="team-role-pill">Vlasnik</span>
        </div>

        <div className="team-owner-card">
          <ProfileAvatar profile={ownerProfile} />
          <div className="team-person-main">
            <strong>{getProfileName(ownerProfile)}</strong>
            <span>{ownerProfile?.email || "Email nije dostupan"}</span>
            <div className="team-inline-badges">
              <span className="team-status-pill">
                {getStatusLabel(ownerMembership?.status)}
              </span>
              <span className="team-access-badge team-access-badge--active">
                <ShieldCheck size={14} /> Puni pristup
              </span>
              {ownerEmployee && (
                <span className="team-access-badge">
                  <BriefcaseBusiness size={14} /> Takođe prima rezervacije
                </span>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="settings-card team-concept-section">
        <div className="settings-card-header">
          <div>
            <h3>Zaposleni u salonu</h3>
            <p>Poslovni employee zapisi, nezavisno od login pristupa.</p>
          </div>
          <span className="team-section-count">{employees.length}</span>
        </div>

        {employees.length === 0 ? (
          <div className="team-empty-state">
            <Users size={22} />
            <p>Nema employee zapisa u ovom salonu.</p>
          </div>
        ) : (
          <div className="team-employee-grid">
            {employees.map((employee) => {
              const membership = employee.profile_id
                ? membersByProfileId.get(employee.profile_id)
                : undefined;
              const hasActiveEmployeeAccess =
                membership?.role === "employee" && membership.status === "active";
              const isOwnerBusinessRecord = employee.profile_id === ownerId;
              const invitation = invitationsByEmployeeId.get(employee.id);

              return (
                <article key={employee.id} className="team-employee-card">
                  <div className="team-person-main">
                    <strong>{getEmployeeName(employee)}</strong>
                    <span>{employee.position || "Pozicija nije navedena"}</span>
                  </div>

                  <div className="team-inline-badges">
                    <span className="team-status-pill">
                      {employee.is_active ? "Aktivan" : "Neaktivan"}
                    </span>
                    <span className="team-access-badge">
                      {employee.is_bookable ? "Prima rezervacije" : "Nije bookable"}
                    </span>
                    <span className="team-access-badge">
                      {employee.is_public ? "Javno vidljiv" : "Nije javan"}
                    </span>
                  </div>

                  {isOwnerBusinessRecord ? (
                    <p className="team-access-message">
                      Poslovni zapis vlasnika. Authorization uloga dolazi iz owner
                      naloga, ne iz pozicije zaposlenog.
                    </p>
                  ) : hasActiveEmployeeAccess ? (
                    <p className="team-access-message team-access-message--active">
                      <BadgeCheck size={15} /> Pristup aplikaciji aktivan · Uloga:
                      Zaposleni
                    </p>
                  ) : employee.profile_id ? (
                    <p className="team-link-warning">
                      Nalog postoji, ali pristup nije aktivan
                      {membership ? ` · ${getStatusLabel(membership.status)}` : ""}
                    </p>
                  ) : !invitationStatusesLoaded ? (
                    <p className="team-link-warning">
                      Status pristupa trenutno nije dostupan
                    </p>
                  ) : invitation?.status === "invited" ? (
                    <div className="team-invitation-status">
                      <p className="team-access-message team-access-message--invited">
                        Poziv poslat
                      </p>
                      <span>{invitation.email}</span>
                      <small>
                        {new Intl.DateTimeFormat("sr-RS", {
                          dateStyle: "medium",
                        }).format(new Date(invitation.createdAt))}
                      </small>
                    </div>
                  ) : invitation?.status === "expired" ? (
                    <p className="team-link-warning">Poziv je istekao</p>
                  ) : invitation?.status === "revoked" ? (
                    <p className="team-link-warning">Poziv je opozvan</p>
                  ) : invitation?.status === "accepted" ? (
                    <p className="team-link-warning">
                      Poziv je prihvaćen, ali nalog nije pravilno povezan
                    </p>
                  ) : (
                    <p className="team-access-message">
                      Pristup aplikaciji nije omogućen
                    </p>
                  )}

                  {currentRole === "owner" &&
                    employee.is_active &&
                    !employee.profile_id &&
                    invitation?.status !== "invited" &&
                    invitation?.status !== "accepted" && (
                      <button
                        type="button"
                        className="settings-primary-btn team-invite-btn"
                        disabled={!invitationStatusesLoaded}
                        onClick={() => {
                          setInviteMessage(null);
                          setEmployeeToInvite(employee);
                        }}
                      >
                        {invitationStatusesLoaded
                          ? "Pozovi u aplikaciju"
                          : "Status poziva nije dostupan"}
                      </button>
                    )}

                  {currentRole === "owner" && !employee.profile_id && (
                    ownerEmployee ? (
                      <p className="team-access-message">
                        Owner nalog je već povezan sa zaposlenim „
                        {getEmployeeName(ownerEmployee)}“.
                      </p>
                    ) : (
                      <button
                        type="button"
                        className="settings-secondary-btn team-owner-link-btn"
                        disabled={linkingEmployeeId !== null}
                        onClick={() => void handleOwnerLink(employee.id)}
                      >
                        {linkingEmployeeId === employee.id
                          ? "Povezivanje..."
                          : "Poveži sa mojim nalogom"}
                      </button>
                    )
                  )}
                </article>
              );
            })}
          </div>
        )}
        {linkMessage && (
          <p className="settings-save-message standalone" role="status">
            {linkMessage}
          </p>
        )}
        {inviteMessage && (
          <p className="settings-save-message standalone" role="status">
            {inviteMessage}
          </p>
        )}
        {invitationStatusError && (
          <p className="team-invitation-warning" role="status">
            {invitationStatusError}
          </p>
        )}
      </section>

      <section className="settings-card team-concept-section">
        <div className="settings-card-header">
          <div>
            <h3>Pristup aplikaciji</h3>
            <p>Membership nalozi koji nisu vlasnik salona.</p>
          </div>
          <span className="team-section-count">{applicationMembers.length}</span>
        </div>

        {applicationMembers.length === 0 ? (
          <div className="team-empty-state compact">
            <ShieldCheck size={22} />
            <p>Nema dodatnih članova aplikacije.</p>
          </div>
        ) : (
          <div className="team-member-list">
            {applicationMembers.map((member) => {
              const profile = profilesById.get(member.profile_id);
              const employee = employeesByProfileId.get(member.profile_id);

              return (
                <article key={member.id} className="team-member-card">
                  <ProfileAvatar profile={profile} />
                  <div className="team-person-main">
                    <strong>{getProfileName(profile)}</strong>
                    <span>{profile?.email || "Email nije dostupan"}</span>
                    <div className="team-inline-badges">
                      <span className="team-role-pill">
                        {getMemberRoleLabel(member, ownerId)}
                      </span>
                      <span className="team-status-pill">
                        {getStatusLabel(member.status)}
                      </span>
                    </div>
                    {!employee && (
                      <p className="team-link-warning">
                        Nalog postoji, ali nije povezan sa zaposlenim.
                      </p>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <div className="team-info-box">
        <BriefcaseBusiness size={17} />
        <p>
          Pozicija zaposlenog je poslovni podatak. Login uloga i pristup dolaze
          isključivo iz membership zapisa. Zaposleni bez naloga može dobiti
          bezbedan email poziv i sam postaviti lozinku.
        </p>
      </div>

      {employeeToInvite && currentRole === "owner" && (
        <TeamInviteModal
          employee={employeeToInvite}
          onClose={() => setEmployeeToInvite(null)}
          onSubmit={handleInvite}
        />
      )}
    </div>
  );
}
