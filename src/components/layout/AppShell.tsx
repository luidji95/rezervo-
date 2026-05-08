
import Link from "next/link";

type AppShellProps = {
  children: React.ReactNode;
};

export default function AppShell({
  children,
}: AppShellProps) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar__logo">
          Rezervo
        </div>

        <nav className="sidebar__nav">
            <Link href="/dashboard">Dashboard</Link>
            <Link href="/calendar">Calendar</Link>
            <Link href="/clients">Clients</Link>
            <Link href="/services">Services</Link>
            <Link href="/employees">Employees</Link>
            <Link href="/settings">Settings</Link>
         </nav>
      </aside>

      <div className="app-shell__content">
        <header className="topbar">
          <h2>Dashboard</h2>
        </header>

        <main className="page-content">
          {children}
        </main>
      </div>
    </div>
  );
}