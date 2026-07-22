"use client";

import { useState } from "react";
import {
  CalendarX,
  Clock,
  CreditCard,
  Scissors,
  Settings,
  Sparkles,
  Users,
} from "lucide-react";

import { BillingPreview } from "@/features/billing/components/BillingPreview";
import ClosuresManager from "@/features/settings/closures/ClosureManager";
import GeneralManager from "@/features/settings/general/GeneralManager";
import TeamManager from "@/features/settings/team/TeamManager";
import WorkingHoursManager from "@/features/settings/working-hours/WorkingHoursManager";

import "./settings.css";

export type SettingsTabId =
  | "general"
  | "working-hours"
  | "closures"
  | "services"
  | "team"
  | "ai"
  | "billing";

const SETTINGS_TABS = [
  { id: "general", label: "Opšte", icon: Settings },
  { id: "working-hours", label: "Radno vreme", icon: Clock },
  { id: "closures", label: "Neradni dani", icon: CalendarX },
  { id: "services", label: "Usluge i cene", icon: Scissors },
  { id: "team", label: "Tim i dozvole", icon: Users },
  { id: "ai", label: "AI Receptionist", icon: Sparkles },
  { id: "billing", label: "Plaćanje i plan", icon: CreditCard },
] satisfies {
  id: SettingsTabId;
  label: string;
  icon: typeof Settings;
}[];

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTabId>("general");

  return (
    <div className="settings-page">
      <header className="settings-top-header">
        <div>
          <h1>Podešavanja</h1>
          <p>Upravljajte salonom, timom, uslugama i sistemskim podešavanjima.</p>
        </div>
      </header>

      <nav className="settings-tabs">
        {SETTINGS_TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              className={`settings-tab-btn ${activeTab === tab.id ? "active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <Icon size={17} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </nav>

      <main className="settings-content">
        {activeTab === "general" && <GeneralManager onChangeTab={setActiveTab} />}
        {activeTab === "working-hours" && <WorkingHoursManager />}
        {activeTab === "closures" && <ClosuresManager />}
        {activeTab === "services" && (
          <SettingsPlaceholder title="Usluge i cene" description="Ovde ćemo kasnije ubaciti ServicesManager." />
        )}
        {activeTab === "team" && <TeamManager />}
        {activeTab === "ai" && (
          <SettingsPlaceholder title="AI Receptionist" description="Podešavanja AI recepcionera dolaze kasnije." />
        )}
        {activeTab === "billing" && <BillingPreview />}
      </main>
    </div>
  );
}

function SettingsPlaceholder({ title, description }: { title: string; description: string }) {
  return (
    <div className="settings-card">
      <h3>{title}</h3>
      <p className="card-sub">{description}</p>
    </div>
  );
}
