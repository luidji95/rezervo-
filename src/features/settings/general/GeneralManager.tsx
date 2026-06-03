'use client';

import React, { useState } from 'react';
import { useSalon } from '@/context/SalonContext';
import { updateCurrentSalon } from '@/services/salonService';

// TIP ZA PROPSE IZ CONTEXTA (Ovo automatski izvlači tip tvog salona)
type SalonType = NonNullable<ReturnType<typeof useSalon>['currentSalon']>;

/* ==========================================================================
   1. PARENT KOMPONENTA: Upravlja učitavanjem podataka i proverom stanja
   ========================================================================== */
export default function GeneralManager() {
  const { currentSalon, salonLoading } = useSalon();

  if (salonLoading) {
    return (
      <div className="settings-card">
        <p>Učitavanje podataka o vašem salonu...</p>
      </div>
    );
  }

  if (!currentSalon) {
    return (
      <div className="settings-card">
        <p style={{ color: '#dc2626' }}>Greška: Podaci o salonu nisu uspešno učitani.</p>
      </div>
    );
  }

  // Tek kada smo 100% sigurni da imamo salon, renderujemo formu i prosleđujemo ga kao prop
  return <GeneralSettingsForm salon={currentSalon} />;
}

/* ==========================================================================
   2. CHILD KOMPONENTA: Inicijalizuje state instant pri mount-u (NEMA useEffect-a)
   ========================================================================== */
function GeneralSettingsForm({ salon }: { salon: SalonType }) {
  const { refetchSalon } = useSalon();
  
  // Kontrola režima izmene za kartice
  const [isEditingInfo, setIsEditingInfo] = useState(false);
  const [isEditingLang, setIsEditingLang] = useState(false);
  
  // Čist useState - dobija podatke ODMAH, bez čekanja na efekte
  const [formData, setFormData] = useState({
    name: salon.name || '',
    phone: salon.phone || '',
    email: salon.email || '',
    websiteUrl: salon.website_url || '',
    city: salon.city || '',
    addressLine: salon.address_line || '',
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleInfoSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      await updateCurrentSalon({
        salonId: salon.id,
        name: formData.name,
        phone: formData.phone || null,
        email: formData.email || null,
        websiteUrl: formData.websiteUrl || null,
        city: formData.city || null,
        addressLine: formData.addressLine || null,
      });

      await refetchSalon(); 
      setIsEditingInfo(false);
    } catch (error: unknown) {
      console.error('Greška tokom ažuriranja:', error);
      if (error instanceof Error) {
        setErrorMsg(error.message);
      } else {
        setErrorMsg('Došlo je do greške prilikom čuvanja podataka.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="settings-view-wrapper">
      
      {/* KARTICA 1: OPŠTE INFORMACIJE SALONA */}
      <div className="settings-card">
        <div className="card-header-actions">
          <div>
            <h3>Opšte informacije</h3>
            <p>Osnovni identitet i kontakt podaci vašeg salona.</p>
          </div>
          {!isEditingInfo && (
            <button className="btn-card-edit" onClick={() => setIsEditingInfo(true)}>
              Uredi
            </button>
          )}
        </div>

        {errorMsg && <div className="error-banner" style={{ color: '#dc2626', marginBottom: '16px', fontSize: '13px', fontWeight: 500 }}>{errorMsg}</div>}

        {!isEditingInfo ? (
          /* READ-ONLY PRIKAZ */
          <div className="salon-info-block">
            <div className="salon-logo-placeholder">
              <span className="logo-text">
                {salon.name ? salon.name.charAt(0).toUpperCase() : 'H'}
              </span>
            </div>
            <div className="salon-info-data-grid">
              <div>
                <span className="data-label">Naziv salona</span>
                <p className="data-value">{salon.name || '/'}</p>
              </div>
              <div>
                <span className="data-label">Grad</span>
                <p className="data-value">{salon.city || '/'}</p>
              </div>
              <div>
                <span className="data-label">Adresa</span>
                <p className="data-value">{salon.address_line || '/'}</p>
              </div>
              <div>
                <span className="data-label">Email</span>
                <p className="data-value">{salon.email || '/'}</p>
              </div>
              <div>
                <span className="data-label">Web sajt</span>
                <p className="data-value">{salon.website_url || '/'}</p>
              </div>
              <div>
                <span className="data-label">Telefon</span>
                <p className="data-value">{salon.phone || '/'}</p>
              </div>
            </div>
          </div>
        ) : (
          /* INTERAKTIVNA FORMA ZA IZMENU */
          <form onSubmit={handleInfoSubmit} className="salon-edit-form">
            <div className="form-grid-inputs">
              <div className="input-field-group">
                <label>Naziv salona *</label>
                <input 
                  type="text" 
                  value={formData.name} 
                  onChange={e => setFormData({...formData, name: e.target.value})} 
                  required
                />
              </div>
              <div className="input-field-group">
                <label>Grad</label>
                <input 
                  type="text" 
                  value={formData.city} 
                  onChange={e => setFormData({...formData, city: e.target.value})} 
                />
              </div>
              <div className="input-field-group">
                <label>Adresa</label>
                <input 
                  type="text" 
                  value={formData.addressLine} 
                  onChange={e => setFormData({...formData, addressLine: e.target.value})} 
                />
              </div>
              <div className="input-field-group">
                <label>Email</label>
                <input 
                  type="email" 
                  value={formData.email} 
                  onChange={e => setFormData({...formData, email: e.target.value})} 
                />
              </div>
              <div className="input-field-group">
                <label>Web sajt</label>
                <input 
                  type="text" 
                  value={formData.websiteUrl} 
                  onChange={e => setFormData({...formData, websiteUrl: e.target.value})} 
                />
              </div>
              <div className="input-field-group">
                <label>Telefon</label>
                <input 
                  type="text" 
                  value={formData.phone} 
                  onChange={e => setFormData({...formData, phone: e.target.value})} 
                />
              </div>
            </div>
            <div className="form-actions-buttons">
              <button type="button" className="btn-cancel" onClick={() => setIsEditingInfo(false)}>
                Otkaži
              </button>
              <button type="submit" className="btn-save" disabled={isSubmitting}>
                {isSubmitting ? 'Čuvanje...' : 'Sačuvaj izmene'}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* KARTICA 2: VALUTA I JEZIK */}
      <div className="settings-card">
        <div className="card-header-actions">
          <div>
            <h3>Valuta i jezik</h3>
            <p>Konfiguracija lokalizacije za vaš salon.</p>
          </div>
          <button className="btn-card-edit" onClick={() => setIsEditingLang(!isEditingLang)}>
            {isEditingLang ? 'Zatvori' : 'Uredi'}
          </button>
        </div>
        <div className="form-row-inputs">
          <div className="input-select-wrapper">
            <label>Valuta sistema</label>
            <select disabled={!isEditingLang} defaultValue={salon.default_currency || "RSD"}>
              <option value="RSD">RSD (Srpski dinar)</option>
              <option value="EUR">EUR (Euro)</option>
            </select>
          </div>
          <div className="input-select-wrapper">
            <label>Jezik interfejsa</label>
            <select disabled={!isEditingLang}>
              <option>Srpski (Latinica)</option>
              <option>English</option>
            </select>
          </div>
        </div>
      </div>

      {/* KARTICA 3: AUTOMATIZACIJA I SISTEM */}
      <div className="settings-card">
        <h3>Podešavanje sistema</h3>
        <p className="card-sub">Pravila ponašanja aplikacije pri zakazivanju klijenata.</p>
        
        <div className="system-toggles-list">
          <div className="toggle-row">
            <div className="toggle-info">
              <div>
                <h4>Automatsko potvrđivanje termina</h4>
                <p>Nove rezervacije sa javnog linka dobijaju status &apos;potvrđeno&apos; instant.</p>
              </div>
            </div>
            <label className="switch">
              <input type="checkbox" defaultChecked={salon.booking_enabled} />
              <span className="slider round"></span>
            </label>
          </div>

          <div className="toggle-row">
            <div className="toggle-info">
              <div>
                <h4>Online otkazivanje termina</h4>
                <p>Klijenti mogu sami da otkažu dolazak preko linka iz obaveštenja.</p>
              </div>
            </div>
            <label className="switch">
              <input type="checkbox" defaultChecked={salon.online_booking_enabled} />
              <span className="slider round"></span>
            </label>
          </div>
        </div>
      </div>

      {/* KARTICA 4: OPASNA ZONA */}
      <div className="settings-card danger-card">
        <div>
          <h3 className="danger-title">Opasna zona</h3>
          <p>Trajno brisanje salona i svih zabeleženih termina. Akcija je nepovratna.</p>
        </div>
        <button className="btn-danger-outline">Obriši salon</button>
      </div>

    </div>
  );
}