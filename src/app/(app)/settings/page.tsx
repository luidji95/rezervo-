'use client';

import React, { useState } from 'react';
import { Settings, Clock, CalendarX, Scissors, Users } from 'lucide-react';

// Uvozi tvoje prave menadžere koje smo spakovali i optimizovali
import GeneralManager from '@/features/settings/general/GeneralManager';
import WorkingHoursManager from '@/features/settings/working-hours/WorkingHoursManager';
import ClosuresManager from '@/features/settings/closures/ClosureManager';

import './settings.css';

type SubMenuType = 'opste' | 'radno-vreme' | 'neradni-dani' | 'usluge' | 'tim';

export default function SettingsPage() {
  const [activeSubMenu, setActiveSubMenu] = useState<SubMenuType>('opste');

  return (
    <div className="settings-page">
      
      {/* VRH STRANICE */}
      <div className="settings-top-header">
        <h1>Podešavanja</h1>
        <p>Upravljajte svojim salonom, timom i postavkama sistema.</p>
      </div>

      {/* GLAVNI TROKOLONSKI RASPORED */}
      <div className="settings-layout-grid">
        
        {/* KOLONA 1: VERTIKALNI POD-MENI */}
        <aside className="settings-submenu-sidebar">
          <button 
            className={`submenu-btn ${activeSubMenu === 'opste' ? 'active' : ''}`} 
            onClick={() => setActiveSubMenu('opste')}
          >
            <Settings className="lucide-icon" size={18} /> Opšte
          </button>
          <button 
            className={`submenu-btn ${activeSubMenu === 'radno-vreme' ? 'active' : ''}`} 
            onClick={() => setActiveSubMenu('radno-vreme')}
          >
            <Clock className="lucide-icon" size={18} /> Radno vreme
          </button>
          <button 
            className={`submenu-btn ${activeSubMenu === 'neradni-dani' ? 'active' : ''}`} 
            onClick={() => setActiveSubMenu('neradni-dani')}
          >
            <CalendarX className="lucide-icon" size={18} /> Neradni dani
          </button>
          <button 
            className={`submenu-btn ${activeSubMenu === 'usluge' ? 'active' : ''}`} 
            onClick={() => setActiveSubMenu('usluge')}
          >
            <Scissors className="lucide-icon" size={18} /> Usluge i cene
          </button>
          <button 
            className={`submenu-btn ${activeSubMenu === 'tim' ? 'active' : ''}`} 
            onClick={() => setActiveSubMenu('tim')}
          >
            <Users className="lucide-icon" size={18} /> Tim i dozvole
          </button>
        </aside>

        {/* KOLONA 2: DINAMIČKI PRIKAZ LOGIKE (SREDINA) */}
        <main className="settings-main-content">
          {activeSubMenu === 'opste' && <GeneralManager />}
          
          {/* Ubacujemo pravi WorkingHoursManager umesto placeholdera */}
          {activeSubMenu === 'radno-vreme' && <WorkingHoursManager />}

          {/* Ubacujemo pravi ClosuresManager umesto placeholdera */}
          {activeSubMenu === 'neradni-dani' && <ClosuresManager />}

          {/* Placebolderi za buduće module koji čekaju svoj red */}
          {activeSubMenu === 'usluge' && (
            <div className="settings-card">
              <h3>Usluge i cene</h3>
              <p className="card-sub">Ovde će se renderovati vaš ServicesManager.</p>
            </div>
          )}

          {activeSubMenu === 'tim' && (
            <div className="settings-card">
              <h3>Tim i dozvole</h3>
              <p className="card-sub">Ovde će se renderovati vaš TeamManager.</p>
            </div>
          )}
        </main>

        {/* KOLONA 3: DESNI SIDEBAR */}
        <aside className="settings-right-sidebar">
          <div className="sidebar-widget-card">
            <div className="widget-header">
              <h4>👑 Vaš plan</h4>
              <span className="plan-badge">Pro Plan</span>
            </div>
            <p className="plan-date">Aktivan do 12.06.2027.</p>
            <ul className="plan-features-list" style={{ listStyle: 'none', padding: 0, margin: '12px 0', fontSize: '13px' }}>
              <li style={{ marginBottom: '6px' }}>✓ AI Receptionist</li>
              <li style={{ marginBottom: '6px' }}>✓ Neograničeni termini</li>
              <li style={{ marginBottom: '6px' }}>✓ Integracije</li>
            </ul>
            <button className="btn-widget-primary">Upravljaj planom</button>
          </div>

          <div className="sidebar-widget-card" style={{ marginTop: '16px' }}>
            <h4>Integracije</h4>
            <p className="widget-desc">Povezani kanali sa sistemom.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '13px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>📷 Instagram</span> <span style={{ color: '#16a34a', fontWeight: 600 }}>Spojeno</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>💬 WhatsApp</span> <span style={{ color: '#16a34a', fontWeight: 600 }}>Spojeno</span></div>
            </div>
          </div>
        </aside>

      </div>
    </div>
  );
}