"use client";

import { useCallback, useState } from "react";
import { getTodayDateKey } from "@/lib/salonDateTime";
import { usePublicBookingSelection } from "../hooks/usePublicBookingSelection";
import { formatDateLong, formatTimeRange } from "../publicBookingFormat";
import type { PublicCustomerData, PublicSalon, PublicService } from "../types";
import { PublicBookingBar, PublicBookingFooter, PublicBookingProgress } from "./PublicBookingChrome";
import { PUBLIC_DETAILS_FORM_ID, PublicDetailsStep } from "./PublicDetailsStep";
import { PublicBookingSuccess } from "./PublicBookingSuccess";
import { PublicServiceStep } from "./PublicServiceStep";
import { PublicTimeStep } from "./PublicTimeStep";

type Props = { salon: PublicSalon; services: PublicService[] };
type Step = 1 | 2 | 3;

export function PublicBookingSelection({ salon, services }: Props) {
  const timeZone = salon.timezone;
  const [today] = useState(() => getTodayDateKey(timeZone));
  const selection = usePublicBookingSelection(salon.id, salon.slug, today);
  const [requestedStep, setRequestedStep] = useState<Step>(1);
  const [customer, setCustomer] = useState<PublicCustomerData>(selection.customerForm);
  const service = services.find((item) => item.id === selection.selectedServiceId);
  const employee = selection.employees.find((item) => item.id === selection.selectedEmployeeId);
  const slot = selection.selectedSlot;
  // A step is only shown while its inputs are valid: e.g. a 409 clears the slot and returns to the time step.
  const step: Step = !service ? 1 : requestedStep === 3 && (!slot || !employee) ? 2 : requestedStep;

  const goTo = useCallback((next: Step) => {
    setRequestedStep(next);
    window.scrollTo({ top: 0 });
  }, []);

  if (selection.bookingResult && service && employee && slot) {
    return (
      <div className="pb-shell">
        <PublicBookingProgress step={4} />
        <PublicBookingSuccess date={selection.selectedDate} employee={employee} salonName={salon.name} service={service} slot={slot} timeZone={timeZone}
          onBookAnother={() => { selection.resetBookingFlow(); setCustomer({ fullName: "", phone: "", email: "", note: "" }); goTo(1); }} />
        <PublicBookingFooter />
      </div>
    );
  }

  return (
    <div className="pb-shell">
      {step === 1 && (
        <>
          <PublicBookingProgress step={1} />
          <PublicServiceStep salon={salon} services={services} selectedServiceId={selection.selectedServiceId} onSelectService={(id) => void selection.selectService(id)} />
          <PublicBookingBar summary={service && <><span>Izabrano: {service.name}</span><strong>{service.durationMinutes} min</strong></>}>
            <button type="button" className="pb-button" disabled={!service} onClick={() => goTo(2)}>Dalje</button>
          </PublicBookingBar>
        </>
      )}

      {step === 2 && service && (
        <>
          <PublicBookingProgress step={2} onBack={() => goTo(1)} backLabel="Nazad na izbor usluge" />
          <PublicTimeStep
            service={service} today={today} timeZone={timeZone}
            employees={selection.employees} employeesLoading={selection.employeesLoading} employeesError={selection.employeesError}
            selectedEmployeeId={selection.selectedEmployeeId} selectedDate={selection.selectedDate}
            slots={selection.slots} slotsLoading={selection.isLoadingSlots} slotsError={selection.slotsError} selectedSlot={slot}
            bookingError={selection.bookingError}
            onChangeService={() => goTo(1)} onSelectEmployee={selection.selectEmployee}
            onSelectDate={(date) => void selection.selectDate(date)} onSelectSlot={selection.selectSlot}
            onRetryEmployees={selection.retryEmployees} onRetrySlots={() => void selection.retrySlots()}
          />
          <PublicBookingBar summary={slot ? <><span>{formatDateLong(selection.selectedDate)}</span><strong>{formatTimeRange(slot, timeZone)}</strong></> : <span>Izaberite vreme</span>}>
            <button type="button" className="pb-button" disabled={!slot || !employee} onClick={() => goTo(3)}>Dalje</button>
          </PublicBookingBar>
        </>
      )}

      {step === 3 && service && employee && slot && (
        <>
          <PublicBookingProgress step={3} onBack={() => goTo(2)} backLabel="Nazad na izbor termina" />
          <PublicDetailsStep service={service} employee={employee} date={selection.selectedDate} slot={slot} timeZone={timeZone}
            defaultValues={customer} disabled={selection.isCreatingBooking} onDraftChange={setCustomer} onEditTime={() => goTo(2)}
            onSubmit={async (value) => {
              setCustomer(value);
              // The slot was taken meanwhile: return to the time step; picking a new time does not skip ahead.
              if (await selection.createBooking(value) === "conflict") goTo(2);
            }} />
          <PublicBookingBar message={selection.bookingError && <div className="pb-alert" role="alert">{selection.bookingError}</div>}>
            <button type="submit" form={PUBLIC_DETAILS_FORM_ID} className="pb-button" disabled={selection.isCreatingBooking} aria-busy={selection.isCreatingBooking}>
              {selection.isCreatingBooking ? "Zakazujem…" : "Zakaži termin"}
            </button>
          </PublicBookingBar>
        </>
      )}
      <PublicBookingFooter />
    </div>
  );
}
