"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { logoutUser } from "@/services/authService";

// Svi importi ikonica spakovani na jedno mesto bez dupliranja
import { 
  LayoutDashboard, 
  Calendar as CalendarIcon, 
  Users, 
  Scissors, 
  UserSquare2, 
  Settings, 
  ChevronLeft,
  ChevronRight,
  Bell,
  User,
  Plus
} from "lucide-react";

type AppShellProps = {
  children: React.ReactNode;
};

// Mapirane ikonice uz linkove za sidebar
const navLinks = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/calendar", label: "Kalendar", icon: CalendarIcon },
  { href: "/clients", label: "Klijenti", icon: Users },
  { href: "/services", label: "Usluge", icon: Scissors },
  { href: "/employees", label: "Zaposleni", icon: UserSquare2 },
  { href: "/settings", label: "Podešavanja", icon: Settings },
];

export default function AppShell({ children }: AppShellProps) {
  const router = useRouter();
  const pathname = usePathname();

  // Dinamičko mapiranje trenutne stranice za breadcrumb na osnovu rute
  const getPageName = (path: string) => {
    if (path.includes("/calendar")) return "Kalendar";
    if (path.includes("/clients")) return "Klijenti";
    if (path.includes("/services")) return "Usluge";
    if (path.includes("/employees")) return "Zaposleni";
    if (path.includes("/settings")) return "Podešavanja";
    if (path.includes("/dashboard")) return "Dashboard";
    return "Dashboard";
  };

  const currentPage = getPageName(pathname);

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
      {/* SIDEBAR */}
      <aside className="sidebar">
        {/* Gornji deo: Logo i strelica */}
        <div className="sidebar__top">
          <div className="sidebar__logo">
            <span className="logo-icon">R</span>
            Rezervo
          </div>
          <button type="button" className="sidebar__collapse-btn">
            <ChevronLeft size={16} />
          </button>
        </div>

        {/* Srednji deo: Navigacija */}
        <nav className="sidebar__nav">
          {navLinks.map((link) => {
            const isActive = pathname === link.href;
            const Icon = link.icon;

            return (
              <Link
                key={link.href}
                href={link.href}
                className={isActive ? "sidebar__link sidebar__link--active" : "sidebar__link"}
              >
                <Icon size={20} className="nav-icon" />
                <span>{link.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Donji deo: Baner i Profil */}
        <div className="sidebar__footer">
          {/* Ljubičasti baner */}
          <div className="promo-banner">
            <h4>Preporuči i zaradi!</h4>
            <p>Pozovi druge salone i osvoji 1 mesec besplatno.</p>
            <button type="button" className="promo-banner__btn">Pozovi salon</button>
          </div>

          {/* Profilna kartica */}
          <div className="sidebar__profile-card">
            <div className="profile-avatar">
              <UserSquare2 size={20} />
            </div>
            <div className="profile-info">
              <span className="profile-salon">Salon Harmony</span>
              <span className="profile-user">Marko Petrović</span>
            </div>
          </div>
        </div>
      </aside>

      {/* GLAVNI KONTEJNER SA DESNE STRANE */}
      <div className="app-shell__content">
        {/* TOPBAR */}
        <header className="topbar">
          {/* Leva strana: Dinamička Breadcrumb navigacija */}
          <div className="topbar__breadcrumb">
            <span className="breadcrumb-parent">Aplikacija</span>
            <ChevronRight size={14} className="breadcrumb-separator" />
            <span className="breadcrumb-current">{currentPage}</span>
          </div>

          {/* Desna strana: Novi termin, Notifikacije i profil */}
          <div className="topbar__actions">
            {/* Ubačeno premium dugme za kreiranje novog termina direktno iz topbar-a */}
            

            {/* Zvonce za notifikacije */}
            <button type="button" className="topbar-icon-btn" aria-label="Notifikacije">
              <Bell size={20} />
              <span className="notification-dot"></span>
            </button>
            
            {/* Avatar - Logout okidač */}
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

        {/* Dinamički sadržaj stranica */}
        <main className="page-content">{children}</main>
      </div>
    </div>
  );
}