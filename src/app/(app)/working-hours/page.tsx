"use client";

import { useState } from "react";
import { Settings, Clock, CalendarX } from "lucide-react"; // <-- Dodat CalendarX ikonice
import WorkingHoursManager from "@/features/settings/working-hours/WorkingHoursManager";
// Ovde ćemo uvesti ClosuresManager u sledećem koraku, za sada ga komentarišemo da ne puca
// import ClosuresManager from "@/features/settings/closures/ClosuresManager";
import "./settings.css";

export default function SettingsPage() {
  const [activeSubMenu, setActiveSubMenu] = useState("opste");

  return (
    <div className="settings-page">
      {/* GORNJI NASLOV */}
      <div className="settings-top-header">
        <h1>Podešavanja salona</h1>
        <p>Upravljajte osnovnim informacijama, radnim vremenom i konfiguracijom vašeg salona.</p>
      </div>

      {/* TROKOLONSKI GRID */}
      <div className="settings-layout-grid">
        
        {/* KOLONA 1: LEVI POD-MENI */}
        <aside className="settings-submenu-sidebar">
          <button
            onClick={() => setActiveSubMenu("opste")}
            className={`submenu-btn ${activeSubMenu === "opste" ? "active" : ""}`}
          >
            <Settings size={18} className="lucide-icon" />
            Opšte informacije
          </button>
          
          <button
            onClick={() => setActiveSubMenu("radno-vreme")}
            className={`submenu-btn ${activeSubMenu === "radno-vreme" ? "active" : ""}`}
          >
            <Clock size={18} className="lucide-icon" />
            Radno vreme
          </button>

          {/* NOVI TAB ZA NERADNE DANE */}
          <button
            onClick={() => setActiveSubMenu("neradni-dani")}
            className={`submenu-btn ${activeSubMenu === "neradni-dani" ? "active" : ""}`}
          >
            <CalendarX size={18} className="lucide-icon" />
            Neradni dani
          </button>
        </aside>

        {/* KOLONA 2: SREDIŠNJI SADRŽAJ */}
        <main className="settings-main-content">
          {activeSubMenu === "opste" && (
            <div className="settings-card">
              <h3>Opšte informacije</h3>
              <p className="card-sub">Osnovni podaci o vašem salonu koji se prikazuju klijentima prilikom zakazivanja.</p>
              <div style={{ padding: "24px", textAlign: "center", color: "#6b7280", border: "2px dashed #e5e7eb", borderRadius: "8px" }}>
                Forma za izmenu naziva, adrese i telefona salona.
              </div>
            </div>
          )}

          {activeSubMenu === "radno-vreme" && <WorkingHoursManager />}

          {/* USLOV ZA RENDER NOVOG MENADŽERA */}
          {activeSubMenu === "neradni-dani" && (
            <div className="settings-card">
              <h3>Neradni dani i praznici</h3>
              <p className="card-sub">Dodajte jednokratne ili ponovljive neradne dane kada salon ili kompletna ekipa ne rade (npr. državni praznici, kolektivni odmor).</p>
              {/* Ovde uskače <ClosuresManager /> čim ga napravimo */}
              <div style={{ padding: "24px", textAlign: "center", color: "#6b7280", border: "2px dashed #e5e7eb", borderRadius: "8px" }}>
                U sledećem koraku pravimo ClosuresManager.
              </div>
            </div>
          )}
        </main>

        {/* KOLONA 3: DESNI SIDEBAR */}
        <section className="settings-right-sidebar">
          <div className="sidebar-widget-card">
            <div className="widget-header">
              <h4>Vaš Paket</h4>
              <span className="plan-badge">Premium</span>
            </div>
            <p className="plan-date">Ističe: 01. Januara 2027.</p>
            <button className="btn-widget-primary">Unapredi paket</button>
          </div>

          <div className="sidebar-widget-card" style={{ background: "#f9fafb" }}>
            <h4 style={{ margin: "0 0 8px 0", fontSize: "13px" }}>Potrebna vam je pomoć?</h4>
            <p style={{ margin: 0, fontSize: "12px", color: "#6b7280", lineHeight: "1.5" }}>
              Ako imate problema sa podešavanjem radnog vremena ili zaposlenih, kontaktirajte našu podršku.
            </p>
          </div>
        </section>

      </div>
    </div>
  );
}