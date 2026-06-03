'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useSalon } from '@/context/SalonContext';
import { Trash2, Plus, Calendar } from 'lucide-react';

// Uvozimo tvoje tačne servise
import { 
  getSalonClosures, 
  createClosure, 
  deleteClosure 
} from '@/services/closureService'; 



import type { Closure } from '@/types/closure';
import { closureSchema, type ClosureFormInput, type ClosureFormData } from './closureSchema';

export default function ClosuresManager() {
  const { currentSalon, salonLoading } = useSalon();
  const [closures, setClosures] = useState<Closure[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);

  // Učitavanje svih neradnih dana za salon
  useEffect(() => {
    const salonId = currentSalon?.id;
    if (!salonId) return;

    let ignore = false;
    async function loadClosures() {
      try {
        setLoading(true);
        const data = await getSalonClosures(salonId);
        if (!ignore) setClosures(data);
      } catch (error: unknown) {
        console.error('Greška pri učitavanju neradnih dana:', error);
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    loadClosures();
    return () => { ignore = true; };
  }, [currentSalon?.id]);

  // Osvežavanje nakon akcija
  const refreshClosures = useCallback(async () => {
    const salonId = currentSalon?.id;
    if (!salonId) return;

    try {
      const data = await getSalonClosures(salonId);
      setClosures(data);
    } catch (error: unknown) {
      console.error('Greška pri osvežavanju:', error);
    }
  }, [currentSalon?.id]);

  // Brisanje neradnog dana
  async function handleDelete(closureId: string) {
    if (!window.confirm('Da li ste sigurni da želite da obrišete ovaj neradni dan?')) return;
    
    try {
      await deleteClosure(closureId);
      await refreshClosures();
    } catch (error: unknown) {
      console.error('Greška pri brisanju neradnog dana:', error);
    }
  }

  // Formatiranje datuma za lepši prikaz u UI (iz npr. 2026-06-03 u naš format po želji, ili ostaje clean)
  function formatDate(dateStr: string) {
    if (!dateStr) return '';
    // Možeš ostaviti čist string ili ga splitovati ako želiš DD.MM.YYYY. format
    const [year, month, day] = dateStr.split('-');
    return `${day}.${month}.${year}.`;
  }

  if (salonLoading || loading) {
    return (
      <div className="settings-card">
        <p>Učitavanje neradnih dana...</p>
      </div>
    );
  }

  return (
    <div className="settings-view-wrapper" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      
      {/* GLAVNA KARTICA I DUGME ZA DODAVANJE */}
      <div className="settings-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 style={{ margin: 0 }}>Neradni dani</h3>
            <p className="card-sub" style={{ margin: 0 }}>Pregledajte i upravljajte kolektivnim odmorima i državnim praznicima.</p>
          </div>
          {!isAdding && (
            <button 
              onClick={() => setIsAdding(true)} 
              className="btn-save" 
              style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', padding: '8px 12px' }}
            >
              <Plus size={16} />
              Dodaj odmor / praznik
            </button>
          )}
        </div>

        {/* FORMA ZA DODAVANJE (Prikazuje se na klik) */}
        {isAdding && currentSalon?.id && (
          <div style={{ marginTop: '20px', paddingTop: '20px', borderTop: '1px solid #e5e7eb' }}>
            <h4 style={{ margin: '0 0 16px 0', fontSize: '14px', fontWeight: 600 }}>Novi neradni period</h4>
            <ClosureForm 
              salonId={currentSalon.id} 
              onSuccess={async () => {
                setIsAdding(false);
                await refreshClosures();
              }} 
              onCancel={() => setIsAdding(false)} 
            />
          </div>
        )}
      </div>

      {/* LISTA / KARTICE POSTOJEĆIH NERADNIH DANA */}
      <div className="settings-main-content">
        {closures.length === 0 ? (
          <div className="settings-card" style={{ textAlign: 'center', padding: '32px', color: '#6b7280' }}>
            <Calendar size={32} style={{ margin: '0 auto 12px auto', opacity: 0.5 }} />
            <p style={{ margin: 0, fontSize: '14px' }}>Trenutno nema konfigurisanih neradnih dana za ovaj salon.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {closures.map((item) => (
              <div key={item.id} className="settings-card" style={{ padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h4 style={{ margin: '0 0 4px 0', fontSize: '15px', fontWeight: 600, color: '#111827' }}>{item.title}</h4>
                  <p style={{ margin: 0, fontSize: '13px', color: '#4b5563' }}>
                    {item.starts_at === item.ends_at 
                      ? formatDate(item.starts_at) 
                      : `${formatDate(item.starts_at)} do ${formatDate(item.ends_at)}`
                    }
                  </p>
                </div>
                <button 
                  onClick={() => handleDelete(item.id)}
                  style={{ background: 'transparent', border: 'none', color: '#9ca3af', cursor: 'pointer', padding: '8px' }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = '#dc2626')}
                  onMouseLeave={(e) => (e.currentTarget.style.color = '#9ca3af')}
                >
                  <Trash2 size={18} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ==========================================================================
   CHILD KOMPONENTA: Form handler
   ========================================================================== */
type ClosureFormProps = {
  salonId: string;
  onSuccess: () => Promise<void>;
  onCancel: () => void;
};

function ClosureForm({ salonId, onSuccess, onCancel }: ClosureFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ClosureFormInput, unknown, ClosureFormData>({
    resolver: zodResolver(closureSchema),
    defaultValues: {
      title: '',
      starts_at: '',
      ends_at: '',
    }
  });

  async function onSubmit(data: ClosureFormData) {
    try {
      // Šaljemo podatke u tvom tačnom CreateClosurePayload formatu
      await createClosure({
        salon_id: salonId,
        title: data.title,
        starts_at: data.starts_at,
        ends_at: data.ends_at,
        is_full_day: true, // Jer zatvaramo ceo salon na nivou Settings-a
      });
      await onSuccess();
    } catch (error: unknown) {
      console.error('Greška pri kreiranju neradnog dana:', error);
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div className="input-field-group">
        <label>Naziv / Razlog zatvaranja</label>
        <input type="text" placeholder="npr. Kolektivni godišnji odmor, Božić..." {...register('title')} />
        {errors.title && <span className="error-text-span">{errors.title.message}</span>}
      </div>

      <div className="form-grid-inputs" style={{ margin: 0 }}>
        <div className="input-field-group">
          <label>Početni datum</label>
          <input type="date" {...register('starts_at')} />
          {errors.starts_at && <span className="error-text-span">{errors.starts_at.message}</span>}
        </div>

        <div className="input-field-group">
          <label>Završni datum (Uključujući)</label>
          <input type="date" {...register('ends_at')} />
          {errors.ends_at && <span className="error-text-span">{errors.ends_at.message}</span>}
        </div>
      </div>

      <div className="form-actions-buttons" style={{ marginTop: '8px', paddingTop: '12px' }}>
        <button type="button" onClick={onCancel} className="btn-cancel">
          Otkaži
        </button>
        <button type="submit" className="btn-save" disabled={isSubmitting}>
          {isSubmitting ? 'Čuvanje...' : 'Zakaži slobodne dane'}
        </button>
      </div>
    </form>
  );
}