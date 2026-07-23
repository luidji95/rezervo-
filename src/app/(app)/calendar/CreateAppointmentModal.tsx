import React, { useEffect, useRef, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { createAppointmentSchema, CreateAppointmentFormInput } from '../../../types/appointment';
import { Service } from '@/types/service';
import { CalendarEmployee } from '@/services/employeeQueryService'; 

// DODATO: Importuj funkciju za generisanje slotova sa beka i tip
// Zameni putanju i ime ako se kod tebe zove drugačije

import { generateAvailableSlots } from '@/services/availabilityService';
import { AvailableSlot } from '@/types/availability';
import { DEFAULT_SALON_TIME_ZONE, getTodayDateKey } from '@/lib/salonDateTime';

interface CreateAppointmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  salonId: string;
  employees: CalendarEmployee[];
  services: Service[];   
  selectedDate?: string;      // Format: "YYYY-MM-DD"
  selectedEmployeeId?: string; 
  onSuccess: (data: CreateAppointmentFormInput) => Promise<void>;
}

export const CreateAppointmentModal: React.FC<CreateAppointmentModalProps> = ({
  isOpen,
  onClose,
  salonId,
  employees,
  services,
  selectedDate,
  selectedEmployeeId,
  onSuccess
}) => {
  
  // State za čuvanje slobodnih slotova koji stignu sa beka
  const [availableSlots, setAvailableSlots] = useState<AvailableSlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const submittingRef = useRef(false);
  const onCloseRef = useRef(onClose);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
    setValue,
    control
  } = useForm<CreateAppointmentFormInput>({
    resolver: zodResolver(createAppointmentSchema),
    defaultValues: {
      salonId: salonId,
      employeeId: selectedEmployeeId || '',
      serviceId: '',
      startTime: '', // Ovo punimo programski kad korisnik klikne na slot
      bookingSource: 'manual',
      customerNote: '',
      client: {
        fullName: '',
        phone: '',
        email: ''
      }
    }
  });
  useEffect(() => {
    submittingRef.current = isSubmitting;
    onCloseRef.current = onClose;
  }, [isSubmitting, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submittingRef.current) onCloseRef.current();
      if (event.key !== 'Tab') return;
      const focusable = modalRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
      returnFocusRef.current?.focus();
    };
  }, [isOpen]);

  // Pratimo izmene polja u realnom vremenu kako bismo znali kada da okinemo bek za slotove
  const watchedServiceId = useWatch({ control, name: 'serviceId' });
  const watchedEmployeeId = useWatch({ control, name: 'employeeId' });
  
  // Lokalni state samo za HTML date picker
  const [localDate, setLocalDate] = useState(
    selectedDate || getTodayDateKey(DEFAULT_SALON_TIME_ZONE),
  );

  // useEffect koji osluškuje promenu Usluge, Zaposlenog ili Datuma i vuče slotove sa beka
  useEffect(() => {
    async function fetchSlots() {
      if (!watchedServiceId || !watchedEmployeeId || !localDate) {
        setAvailableSlots([]);
        return;
      }

      try {
        setSlotsLoading(true);
        setSelectedSlot(null);
        setValue('startTime', ''); // Resetujemo prethodno izabrano vreme

        // Pozivamo tvoj backend servis sa parametrima
        const data = await generateAvailableSlots({
          salonId,
          serviceId: watchedServiceId,
          employeeId: watchedEmployeeId,
          date: localDate
        });

        // Očekujemo niz slobodnih slotova: data.slots ili samo data u zavisnosti od servisa
        setAvailableSlots(data.slots || data); 
      } catch (err) {
        console.error("Greška pri učitavanju slobodnih slotova:", err);
      } finally {
        setSlotsLoading(false);
      }
    }

    if (isOpen) {
      fetchSlots();
    }
  }, [watchedServiceId, watchedEmployeeId, localDate, salonId, isOpen, setValue]);

  if (!isOpen) return null;

  const requestClose = () => {
    if (!isSubmitting) onClose();
  };

  const handleSlotClick = (isoStartTime: string) => {
    setSelectedSlot(isoStartTime);
    setValue('startTime', isoStartTime, { shouldValidate: true }); // Upisujemo pun ISO string direktno u formu
  };

  const onSubmit = async (data: CreateAppointmentFormInput) => {
    try {
      await onSuccess(data);
      reset();
      setSelectedSlot(null);
      onClose();
    } catch (error) {
      console.error('Greška pri izvršavanju forme:', error);
    }
  };

  // Pomoćna funkcija da izvučemo samo HH:MM iz punog ISO stringa za prikaz na dugmićima
  const formatSlotTime = (isoString: string) => {
    try {
      const date = new Date(isoString);
      return date.toLocaleTimeString('sr-RS', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return isoString;
    }
  };

  return (
    <div className="modal-overlay" onClick={requestClose}>
      <div ref={modalRef} className="modal-container" role="dialog" aria-modal="true" aria-labelledby="create-appointment-title" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 id="create-appointment-title">Novi termin</h2>
          <button ref={closeButtonRef} type="button" className="btn-close-modal" aria-label="Zatvori" disabled={isSubmitting} onClick={requestClose}>&times;</button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="modal-form">
          
          <div className="form-section-title">Podaci o klijentu</div>
          
          <div className="form-group">
            <label>Ime i prezime klijenta *</label>
            <input 
              type="text"
              {...register('client.fullName')} 
              placeholder="Unesite ime i prezime..."
              className={errors.client?.fullName ? 'input-error' : ''}
            />
            {errors.client?.fullName && <span className="error-text">{errors.client.fullName.message}</span>}
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Telefon</label>
              <input 
                type="text"
                {...register('client.phone')} 
                placeholder="06XXXXXXXX"
              />
            </div>

            <div className="form-group">
              <label>Email</label>
              <input 
                type="email"
                {...register('client.email')} 
                placeholder="klijent@gmail.com"
              />
            </div>
          </div>

          <div className="form-section-title">Detalji termina</div>

          {/* 1. SELEKCIJA USLUGE */}
          <div className="form-group">
            <label>Usluga *</label>
            <select {...register('serviceId')} className={errors.serviceId ? 'input-error' : ''}>
              <option value="">Izaberi uslugu...</option>
              {services.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name} ({service.duration_minutes} min) - {service.price} {service.currency}
                </option>
              ))}
            </select>
            {errors.serviceId && <span className="error-text">{errors.serviceId.message}</span>}
          </div>

          {/* 2. SELEKCIJA ZAPOSLENOG */}
          <div className="form-group">
            <label>Zaposleni *</label>
            <select {...register('employeeId')} className={errors.employeeId ? 'input-error' : ''}>
              <option value="">Izaberi zaposlenog...</option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.full_name} {employee.position ? `(${employee.position})` : ''}
                </option>
              ))}
            </select>
            {errors.employeeId && <span className="error-text">{errors.employeeId.message}</span>}
          </div>

          {/* 3. SELEKCIJA DATUMA */}
          <div className="form-group">
            <label>Datum termina *</label>
            <input 
              type="date" 
              value={localDate}
              onChange={(e) => setLocalDate(e.target.value)}
            />
          </div>

          {/* 4. PRIKAZ SLOBODNIH TERMINA (SLOTOVA) */}
          <div className="form-group">
            <label>Slobodni termini za izabrani dan *</label>
            
            {slotsLoading && <p className="loading-slots-text">Učitavam slobodne termine...</p>}
            
            {!slotsLoading && availableSlots.length === 0 && (watchedServiceId && watchedEmployeeId) && (
              <p className="no-slots-text">Nema slobodnih termina za ovaj dan kod izabranog zaposlenog.</p>
            )}

            {!watchedServiceId || !watchedEmployeeId ? (
              <p className="info-slots-text">Izaberite uslugu i zaposlenog da biste videli slobodna vremena.</p>
            ) : null}

            {!slotsLoading && availableSlots.length > 0 && (
              <div className="slots-grid">
                {availableSlots.map((slot) => {
                  const isCurrent = selectedSlot === slot.startTime;
                  return (
                    <button
                      key={slot.startTime}
                      type="button"
                      className={`slot-button ${isCurrent ? 'slot-button-active' : ''}`}
                      onClick={() => handleSlotClick(slot.startTime)}
                    >
                      {formatSlotTime(slot.startTime)}
                    </button>
                  );
                })}
              </div>
            )}
            {errors.startTime && <span className="error-text">{errors.startTime.message}</span>}
          </div>

          <div className="form-group">
            <label>Napomena od klijenta</label>
            <textarea 
              {...register('customerNote')} 
              placeholder="Dodaj napomenu ili specifičan zahtev..."
              rows={2}
            />
          </div>

          <input type="hidden" {...register('salonId')} value={salonId} />

          <div className="modal-actions">
            <button type="button" className="btn-modal-secondary" onClick={onClose}>
              Otkaži
            </button>
            <button type="submit" className="btn-modal-primary" disabled={isSubmitting || !selectedSlot}>
              {isSubmitting ? 'Čuvanje...' : 'Zakaži termin'}
            </button>
          </div>

        </form>
      </div>
    </div>
  );
};
