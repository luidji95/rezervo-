"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { logoutUser } from "@/services/authService";

type AppShellProps = {
  children: React.ReactNode;
};

const navLinks = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/calendar", label: "Calendar" },
  { href: "/clients", label: "Clients" },
  { href: "/services", label: "Services" },
  { href: "/employees", label: "Employees" },
  { href: "/settings", label: "Settings" },
];

export default function AppShell({ children }: AppShellProps) {
  const router = useRouter();
  const pathname = usePathname();

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
        <div className="sidebar__logo">Rezervo</div>

        <nav className="sidebar__nav">
          {navLinks.map((link) => {
            const isActive = pathname === link.href;

            return (
              <Link
                key={link.href}
                href={link.href}
                className={isActive ? "sidebar__link sidebar__link--active" : "sidebar__link"}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="app-shell__content">
        <header className="topbar">
          <h2>Rezervo</h2>

          <button
            type="button"
            className="logout-button"
            onClick={handleLogout}
          >
            Logout
          </button>
        </header>

        <main className="page-content">{children}</main>
      </div>
    </div>
  );
}