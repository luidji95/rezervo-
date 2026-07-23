"use client";

import { useMemo, useState } from "react";
import { getTodayDateKey } from "@/lib/salonDateTime";
import { usePublicBookingSelection } from "../hooks/usePublicBookingSelection";
import type { PublicCustomerData, PublicService } from "../types";
import { PublicBookingSuccess } from "./PublicBookingSuccess";
import { PublicBookingSummary } from "./PublicBookingSummary";
import { PublicCustomerForm } from "./PublicCustomerForm";
import { PublicDatePicker } from "./PublicDatePicker";
import { PublicEmployeeList } from "./PublicEmployeeList";
import { PublicServiceList } from "./PublicServiceList";
import { PublicSlotList } from "./PublicSlotList";

type Props = { salonId: string; salonName: string; salonSlug: string; salonTimeZone: string; services: PublicService[] };
const steps = ["Usluga", "Zaposleni", "Datum", "Vreme", "Kontakt", "Potvrda"];

export function PublicBookingSelection({ salonId, salonName, salonSlug, salonTimeZone, services }: Props) {
  const selection = usePublicBookingSelection(salonId, salonSlug);
  const [customer, setCustomer] = useState<PublicCustomerData>(selection.customerForm);
  const [reviewing, setReviewing] = useState(false);
  const service = services.find((item) => item.id === selection.selectedServiceId);
  const employee = selection.employees.find((item) => item.id === selection.selectedEmployeeId);
  const currentStep = reviewing && selection.selectedSlot ? 6 : selection.selectedSlot ? 5 : selection.selectedDate ? 4 : selection.selectedEmployeeId ? 3 : selection.selectedServiceId ? 2 : 1;

  const progress = useMemo(() => Math.min(currentStep, 6) / 6 * 100, [currentStep]);

  if (selection.bookingResult && service && employee && selection.selectedSlot) {
    return <PublicBookingSuccess date={selection.selectedDate} employee={employee} result={selection.bookingResult} salonName={salonName} service={service} slot={selection.selectedSlot} timeZone={salonTimeZone} onBookAnother={selection.resetBookingFlow} />;
  }

  return (
    <section className="public-booking-wizard" aria-label="Koraci rezervacije">
      <div className="public-wizard-progress">
        <div className="public-wizard-progress-copy"><span>Korak {currentStep} od 6</span><strong>{steps[currentStep - 1]}</strong></div>
        <div className="public-wizard-track" aria-hidden="true"><i style={{ width: `${progress}%` }} /></div>
        <ol>{steps.map((label, index) => <li className={index + 1 <= currentStep ? "is-active" : ""} key={label}><span>{index + 1}</span><small>{label}</small></li>)}</ol>
      </div>

      {currentStep === 1 && <PublicServiceList services={services} disabled={selection.isCreatingBooking} selectedServiceId={selection.selectedServiceId} onSelectService={(id) => void selection.selectService(id)} />}
      {currentStep === 2 && <PublicEmployeeList employees={selection.employees} disabled={selection.isCreatingBooking} error={selection.employeesError} loading={selection.employeesLoading} selectedEmployeeId={selection.selectedEmployeeId} onSelectEmployee={selection.selectEmployee} />}
      {currentStep === 3 && <PublicDatePicker minDate={getTodayDateKey(salonTimeZone)} disabled={selection.isCreatingBooking} selectedDate={selection.selectedDate} onSelectDate={(date) => void selection.selectDate(date)} />}
      {currentStep === 4 && <PublicSlotList error={selection.slotsError} disabled={selection.isCreatingBooking} loading={selection.isLoadingSlots} selectedSlot={selection.selectedSlot} slots={selection.slots} timeZone={salonTimeZone} onSelectSlot={selection.selectSlot} />}
      {currentStep === 5 && <PublicCustomerForm defaultValues={customer} disabled={selection.isCreatingBooking} onContinue={(value) => { setCustomer(value); setReviewing(true); }} />}
      {currentStep === 6 && service && employee && selection.selectedSlot && (
        <section className="public-review-section">
          <div className="public-section-heading"><p className="public-booking-eyebrow">Potvrda</p><h2>Proverite detalje rezervacije</h2></div>
          <PublicBookingSummary customer={customer} date={selection.selectedDate} employee={employee} salonName={salonName} service={service} slot={selection.selectedSlot} timeZone={salonTimeZone} />
          {selection.bookingError && <div className="public-inline-state public-inline-state-error" role="alert">{selection.bookingError}</div>}
          <div className="public-wizard-actions"><button type="button" className="public-booking-secondary-action" disabled={selection.isCreatingBooking} onClick={() => setReviewing(false)}>Izmeni podatke</button><button type="button" className="public-booking-submit" disabled={selection.isCreatingBooking} onClick={() => void selection.createBooking(customer)}>{selection.isCreatingBooking ? "Zakazujem…" : "Potvrdi rezervaciju"}</button></div>
        </section>
      )}

      {currentStep > 1 && currentStep < 6 && <button type="button" className="public-wizard-back" onClick={() => { if (currentStep === 2) void selection.selectService(null); else if (currentStep === 3) selection.selectEmployee(null); else if (currentStep === 4) void selection.selectDate(""); else selection.selectSlot(null); }}>← Nazad</button>}
    </section>
  );
}
