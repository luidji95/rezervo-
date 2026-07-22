import Link from "next/link";

import type { Employee } from "@/types/employee";

type EmployeeDashboardPlaceholderProps = {
  employee: Employee;
  salonName: string;
};

export function EmployeeDashboardPlaceholder({
  employee,
  salonName,
}: EmployeeDashboardPlaceholderProps) {
  const employeeName = employee.display_name || employee.full_name;

  return (
    <main className="dashboard-page">
      <header>
        <p className="dashboard-kpi-label">{salonName}</p>
        <h1>Dobro došli, {employeeName}</h1>
        <p>Vaš radni pregled se priprema.</p>
      </header>

      <section className="dashboard-card">
        <h2>Vaši termini</h2>
        <p>
          Trenutno možete bezbedno pregledati svoj kalendar i listu termina.
          Izmene će biti omogućene u sledećoj fazi.
        </p>
        <div className="dashboard-card-header">
          <Link href="/calendar">Otvori kalendar</Link>
          <Link href="/appointmets">Pogledaj termine</Link>
        </div>
      </section>
    </main>
  );
}
