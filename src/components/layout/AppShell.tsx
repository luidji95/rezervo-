"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Calendar as CalendarIcon,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  Scissors,
  Settings,
  User,
  Users,
  UserSquare2,
} from "lucide-react";

import NotificationBell from "@/components/layout/NotificationBell";
import { useAuthorization } from "@/context/AuthorizationContext";
import {
  hasPermission,
  type Permission,
} from "@/features/authorization/permissions";
import { logoutUser } from "@/services/authService";

type AppShellProps = {
  children: React.ReactNode;
};

const navLinks: Array<{
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  permission: Permission;
  employeeOnly?: boolean;
}> = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    permission: "canViewDashboard",
  },
  {
    href: "/calendar",
    label: "Kalendar",
    icon: CalendarIcon,
    permission: "canViewCalendar",
  },
  {
    href: "/appointmets",
    label: "Termini",
    icon: CalendarClock,
    permission: "canViewAppointments",
    employeeOnly: true,
  },
  {
    href: "/clients",
    label: "Klijenti",
    icon: Users,
    permission: "canViewClients",
  },
  {
    href: "/services",
    label: "Usluge",
    icon: Scissors,
    permission: "canManageServices",
  },
  {
    href: "/employees",
    label: "Zaposleni",
    icon: UserSquare2,
    permission: "canManageEmployees",
  },
  {
    href: "/settings",
    label: "Podešavanja",
    icon: Settings,
    permission: "canManageSettings",
  },
];

function getPageName(path: string) {
  if (path.includes("/calendar")) return "Kalendar";
  if (path.includes("/appointmets")) return "Termini";
  if (path.includes("/clients")) return "Klijenti";
  if (path.includes("/services")) return "Usluge";
  if (path.includes("/employees")) return "Zaposleni";
  if (path.includes("/settings")) return "Podešavanja";
  return "Dashboard";
}

export default function AppShell({ children }: AppShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const {
    currentProfile,
    currentRole,
    currentSalon,
    permissions,
  } = useAuthorization();

  const visibleNavLinks = navLinks.filter(
    (link) =>
      hasPermission(permissions, link.permission) &&
      (!link.employeeOnly || currentRole === "employee"),
  );
  const profileName =
    currentProfile?.full_name?.trim() || currentProfile?.email || "Korisnik";
  const roleLabel = currentRole === "employee" ? "Zaposleni" : "Vlasnik";

  async function handleLogout() {
    try {
      await logoutUser();
      router.replace("/auth/login");
      router.refresh();
    } catch (error) {
      console.error("Failed to logout:", error);
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar__top">
          <div className="sidebar__logo">
            <span className="logo-icon">R</span>
            Rezervo
          </div>
          <button type="button" className="sidebar__collapse-btn">
            <ChevronLeft size={16} />
          </button>
        </div>

        <nav className="sidebar__nav">
          {visibleNavLinks.map((link) => {
            const isActive =
              pathname === link.href || pathname.startsWith(`${link.href}/`);
            const Icon = link.icon;

            return (
              <Link
                key={link.href}
                href={link.href}
                className={
                  isActive
                    ? "sidebar__link sidebar__link--active"
                    : "sidebar__link"
                }
              >
                <Icon size={20} className="nav-icon" />
                <span>{link.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="sidebar__footer">
          {currentRole === "owner" && (
            <div className="promo-banner">
              <h4>Preporuči i zaradi!</h4>
              <p>Pozovi druge salone i osvoji 1 mesec besplatno.</p>
              <button type="button" className="promo-banner__btn">
                Pozovi salon
              </button>
            </div>
          )}

          <div className="sidebar__profile-card">
            <div className="profile-avatar">
              <UserSquare2 size={20} />
            </div>
            <div className="profile-info">
              <span className="profile-salon">
                {currentSalon?.name ?? "Salon"}
              </span>
              <span className="profile-user">
                {profileName} · {roleLabel}
              </span>
            </div>
          </div>
        </div>
      </aside>

      <div className="app-shell__content">
        <header className="topbar">
          <div className="topbar__breadcrumb">
            <span className="breadcrumb-parent">Aplikacija</span>
            <ChevronRight size={14} className="breadcrumb-separator" />
            <span className="breadcrumb-current">{getPageName(pathname)}</span>
          </div>

          <div className="topbar__actions">
            {currentRole === "owner" && <NotificationBell />}
            <button
              type="button"
              className="topbar-avatar-btn"
              onClick={handleLogout}
              title="Odjavi se"
            >
              <User size={18} />
            </button>
          </div>
        </header>

        <main className="page-content">{children}</main>
      </div>
    </div>
  );
}
