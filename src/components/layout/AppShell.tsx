"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Calendar as CalendarIcon,
  CalendarClock,
  ChartNoAxesCombined,
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  Menu,
  Scissors,
  Settings,
  User,
  Users,
  UserSquare2,
  X,
} from "lucide-react";

import NotificationBell from "@/components/layout/NotificationBell";
import { useEntitlements } from "@/features/billing/hooks/useEntitlements";
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
    href: "/statistics",
    label: "Statistika",
    icon: ChartNoAxesCombined,
    permission: "canViewStatistics",
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
  if (path.includes("/statistics")) return "Statistika";
  if (path.includes("/settings")) return "Podešavanja";
  return "Dashboard";
}

export default function AppShell({ children }: AppShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const {
    currentProfile,
    currentMembership,
    currentRole,
    currentSalon,
    currentEmployee,
    permissions,
    source,
    loading: authorizationLoading,
  } = useAuthorization();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const { entitlements, loading: entitlementsLoading } = useEntitlements();
  const businessReadOnly = !entitlementsLoading && entitlements?.isReadOnly === true;
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!mobileNavOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const sidebar = sidebarRef.current;
    const focusable = sidebar?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    focusable?.[0]?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMobileNavOpen(false);
        menuButtonRef.current?.focus();
        return;
      }

      if (event.key !== "Tab" || !focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [mobileNavOpen]);

  function closeMobileNav() {
    setMobileNavOpen(false);
  }

  const visibleNavLinks = navLinks.filter(
    (link) =>
      hasPermission(permissions, link.permission) &&
      (!link.employeeOnly || currentRole === "employee"),
  );
  const profileName =
    currentProfile?.full_name?.trim() || currentProfile?.email || "Korisnik";
  const roleLabel = currentRole === "employee" ? "Zaposleni" : "Vlasnik";
  const hasNotificationContext =
    !authorizationLoading &&
    Boolean(currentProfile && currentSalon) &&
    hasPermission(permissions, "canViewNotifications") &&
    ((currentRole === "owner" &&
      (currentMembership?.status === "active" || source === "owner_fallback")) ||
      (currentRole === "employee" &&
        currentMembership?.status === "active" &&
        Boolean(currentEmployee)));

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
      <button
        type="button"
        className={`sidebar-backdrop${mobileNavOpen ? " sidebar-backdrop--visible" : ""}`}
        aria-label="Zatvori navigaciju"
        aria-hidden={!mobileNavOpen}
        tabIndex={mobileNavOpen ? 0 : -1}
        onClick={() => {
          closeMobileNav();
          menuButtonRef.current?.focus();
        }}
      />
      <aside
        ref={sidebarRef}
        id="app-navigation"
        className={`sidebar${mobileNavOpen ? " sidebar--open" : ""}`}
        aria-label="Glavna navigacija"
      >
        <div className="sidebar__top">
          <div className="sidebar__logo">
            <span className="logo-icon">R</span>
            Rezervo
          </div>
          <button
            type="button"
            className="sidebar__collapse-btn"
            aria-label="Zatvori navigaciju"
            onClick={() => {
              closeMobileNav();
              menuButtonRef.current?.focus();
            }}
          >
            <ChevronLeft className="sidebar__desktop-collapse-icon" size={16} />
            <X className="sidebar__mobile-close-icon" size={20} />
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
                onClick={closeMobileNav}
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
          <button
            ref={menuButtonRef}
            type="button"
            className="topbar__menu-button"
            aria-label="Otvori navigaciju"
            aria-controls="app-navigation"
            aria-expanded={mobileNavOpen}
            onClick={() => setMobileNavOpen(true)}
          >
            <Menu size={22} />
          </button>
          <div className="topbar__mobile-title">
            <span className="logo-icon">R</span>
            <span>{getPageName(pathname)}</span>
          </div>
          <div className="topbar__breadcrumb">
            <span className="breadcrumb-parent">Aplikacija</span>
            <ChevronRight size={14} className="breadcrumb-separator" />
            <span className="breadcrumb-current">{getPageName(pathname)}</span>
          </div>

          <div className="topbar__actions">
            {hasNotificationContext && <NotificationBell />}
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

        <main className="page-content">
          {businessReadOnly && (
            <div className="subscription-read-only-banner" role="status">
              <span>VaÅ¡ nalog trenutno ima pristup samo za pregled. Aktivirajte paket da biste menjali podatke salona.</span>
              <Link href="/settings?tab=billing">Pogledaj paket</Link>
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
