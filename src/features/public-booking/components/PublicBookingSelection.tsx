"use client";

import { usePublicBookingSelection } from "../hooks/usePublicBookingSelection";
import type { PublicService } from "../types";
import { PublicDatePicker } from "./PublicDatePicker";
import { PublicBookingSuccess } from "./PublicBookingSuccess";
import { PublicCustomerForm } from "./PublicCustomerForm";
import { PublicEmployeeList } from "./PublicEmployeeList";
import { PublicServiceList } from "./PublicServiceList";
import { PublicSlotList } from "./PublicSlotList";

type PublicBookingSelectionProps = {
  salonId: string;
  salonName: string;
  salonSlug: string;
  services: PublicService[];
};

export function PublicBookingSelection({
  salonId,
  salonName,
  salonSlug,
  services,
}: PublicBookingSelectionProps) {
  const selection = usePublicBookingSelection(salonId, salonSlug);
  const minimumDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Belgrade",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const selectedService = services.find(
    (service) => service.id === selection.selectedServiceId
  );
  const selectedEmployee = selection.employees.find(
    (employee) => employee.id === selection.selectedEmployeeId
  );

  if (
    selection.bookingResult &&
    selectedService &&
    selectedEmployee &&
    selection.selectedSlot
  ) {
    return (
      <PublicBookingSuccess
        date={selection.selectedDate}
        employee={selectedEmployee}
        result={selection.bookingResult}
        salonName={salonName}
        service={selectedService}
        slot={selection.selectedSlot}
        onBookAnother={selection.resetBookingFlow}
      />
    );
  }

  return (
    <>
      <PublicServiceList
        services={services}
        disabled={selection.isCreatingBooking}
        selectedServiceId={selection.selectedServiceId}
        onSelectService={(serviceId) => {
          void selection.selectService(serviceId);
        }}
      />

      {selection.selectedServiceId && (
        <PublicEmployeeList
          employees={selection.employees}
          disabled={selection.isCreatingBooking}
          error={selection.employeesError}
          loading={selection.employeesLoading}
          selectedEmployeeId={selection.selectedEmployeeId}
          onSelectEmployee={selection.selectEmployee}
        />
      )}

      {selection.selectedEmployeeId === "any" && (
        <section className="public-date-section">
          <div className="public-inline-state" role="status">
            Izaberite konkretnog zaposlenog da biste videli slobodne termine.
          </div>
        </section>
      )}

      {selection.selectedEmployeeId &&
        selection.selectedEmployeeId !== "any" && (
          <PublicDatePicker
            minDate={minimumDate}
            disabled={selection.isCreatingBooking}
            selectedDate={selection.selectedDate}
            onSelectDate={(date) => {
              void selection.selectDate(date);
            }}
          />
        )}

      {selection.selectedDate &&
        selection.selectedEmployeeId &&
        selection.selectedEmployeeId !== "any" && (
          <PublicSlotList
            error={selection.slotsError}
            disabled={selection.isCreatingBooking}
            loading={selection.isLoadingSlots}
            selectedSlot={selection.selectedSlot}
            slots={selection.slots}
            onSelectSlot={selection.selectSlot}
          />
        )}

      {selection.bookingError && !selection.selectedSlot && (
        <div className="public-booking-flow-error public-inline-state public-inline-state-error" role="alert">
          {selection.bookingError}
        </div>
      )}

      {selection.selectedSlot && selectedService && selectedEmployee && (
        <PublicCustomerForm
          bookingError={selection.bookingError}
          date={selection.selectedDate}
          defaultValues={selection.customerForm}
          employee={selectedEmployee}
          isSubmitting={selection.isCreatingBooking}
          salonName={salonName}
          service={selectedService}
          slot={selection.selectedSlot}
          onSubmit={selection.createBooking}
        />
      )}
    </>
  );
}
