"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  createPublicBooking,
  getPublicAvailability,
  getPublicEmployeesForService,
  PublicBookingConflictError,
} from "../services/publicBookingService";
import type {
  PublicAvailabilitySlot,
  PublicBookingResult,
  PublicCustomerData,
  PublicEmployee,
  PublicEmployeeSelection,
} from "../types";

const EMPTY_CUSTOMER: PublicCustomerData = {
  fullName: "",
  phone: "",
  email: "",
};

export function usePublicBookingSelection(salonId: string, salonSlug: string) {
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(
    null
  );
  const [selectedEmployeeId, setSelectedEmployeeId] =
    useState<PublicEmployeeSelection>(null);
  const [employees, setEmployees] = useState<PublicEmployee[]>([]);
  const [employeesLoading, setEmployeesLoading] = useState(false);
  const [employeesError, setEmployeesError] = useState(false);
  const [selectedDate, setSelectedDate] = useState("");
  const [slots, setSlots] = useState<PublicAvailabilitySlot[]>([]);
  const [selectedSlot, setSelectedSlot] =
    useState<PublicAvailabilitySlot | null>(null);
  const [isLoadingSlots, setIsLoadingSlots] = useState(false);
  const [slotsError, setSlotsError] = useState(false);
  const [customerForm, setCustomerForm] =
    useState<PublicCustomerData>(EMPTY_CUSTOMER);
  const [isCreatingBooking, setIsCreatingBooking] = useState(false);
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [bookingResult, setBookingResult] =
    useState<PublicBookingResult | null>(null);
  const employeeRequestIdRef = useRef(0);
  const slotRequestIdRef = useRef(0);
  const slotAbortControllerRef = useRef<AbortController | null>(null);
  const lastSlotRequestKeyRef = useRef<string | null>(null);
  const creatingBookingRef = useRef(false);
  const idempotencyKeyRef = useRef<string | null>(null);

  const resetAvailability = useCallback(() => {
    slotRequestIdRef.current += 1;
    slotAbortControllerRef.current?.abort();
    slotAbortControllerRef.current = null;
    lastSlotRequestKeyRef.current = null;
    setSelectedDate("");
    setSlots([]);
    setSelectedSlot(null);
    setIsLoadingSlots(false);
    setSlotsError(false);
    setBookingError(null);
    idempotencyKeyRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      slotAbortControllerRef.current?.abort();
    };
  }, []);

  const selectService = useCallback(
    async (serviceId: string | null) => {
      const requestId = employeeRequestIdRef.current + 1;
      employeeRequestIdRef.current = requestId;

      setSelectedServiceId(serviceId);
      setSelectedEmployeeId(null);
      setEmployees([]);
      setEmployeesError(false);
      setBookingError(null);
      idempotencyKeyRef.current = null;
      resetAvailability();

      if (!serviceId) {
        setEmployeesLoading(false);
        return;
      }

      setEmployeesLoading(true);

      try {
        const nextEmployees = await getPublicEmployeesForService(
          salonId,
          serviceId
        );

        if (employeeRequestIdRef.current === requestId) {
          setEmployees(nextEmployees);
        }
      } catch (error) {
        console.error("Failed to load employees for public booking:", error);

        if (employeeRequestIdRef.current === requestId) {
          setEmployeesError(true);
        }
      } finally {
        if (employeeRequestIdRef.current === requestId) {
          setEmployeesLoading(false);
        }
      }
    },
    [resetAvailability, salonId]
  );

  const selectEmployee = useCallback(
    (employeeId: PublicEmployeeSelection) => {
      setSelectedEmployeeId(employeeId);
      setBookingError(null);
      idempotencyKeyRef.current = null;
      resetAvailability();
    },
    [resetAvailability]
  );

  const selectDate = useCallback(
    async (date: string) => {
      const serviceId = selectedServiceId;
      const employeeId = selectedEmployeeId;
      const canLoadAvailability =
        Boolean(date && serviceId && employeeId) && employeeId !== "any";
      const requestKey = canLoadAvailability
        ? [salonId, serviceId, employeeId, date].join(":")
        : null;

      if (
        requestKey &&
        date === selectedDate &&
        lastSlotRequestKeyRef.current === requestKey
      ) {
        return;
      }

      setSelectedDate(date);
      setSlots([]);
      setSelectedSlot(null);
      setSlotsError(false);
      setBookingError(null);
      idempotencyKeyRef.current = null;

      slotRequestIdRef.current += 1;
      const requestId = slotRequestIdRef.current;
      slotAbortControllerRef.current?.abort();
      slotAbortControllerRef.current = null;

      if (
        !canLoadAvailability ||
        !requestKey ||
        !serviceId ||
        !employeeId ||
        employeeId === "any"
      ) {
        lastSlotRequestKeyRef.current = null;
        setIsLoadingSlots(false);
        return;
      }

      lastSlotRequestKeyRef.current = requestKey;
      const controller = new AbortController();
      slotAbortControllerRef.current = controller;
      setIsLoadingSlots(true);

      try {
        const nextSlots = await getPublicAvailability(
          {
            salonId,
            serviceId,
            employeeId,
            date,
          },
          controller.signal
        );

        if (slotRequestIdRef.current === requestId) {
          setSlots(nextSlots);
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          return;
        }

        console.error("Failed to load public availability:", error);

        if (slotRequestIdRef.current === requestId) {
          lastSlotRequestKeyRef.current = null;
          setSlotsError(true);
        }
      } finally {
        if (slotRequestIdRef.current === requestId) {
          slotAbortControllerRef.current = null;
          setIsLoadingSlots(false);
        }
      }
    },
    [salonId, selectedDate, selectedEmployeeId, selectedServiceId]
  );

  const createBooking = useCallback(
    async (customer: PublicCustomerData) => {
      if (
        creatingBookingRef.current ||
        !selectedServiceId ||
        !selectedEmployeeId ||
        selectedEmployeeId === "any" ||
        !selectedSlot ||
        !selectedDate
      ) {
        return;
      }

      creatingBookingRef.current = true;
      setCustomerForm(customer);
      setIsCreatingBooking(true);
      setBookingError(null);

      try {
        const idempotencyKey =
          idempotencyKeyRef.current ?? crypto.randomUUID();
        idempotencyKeyRef.current = idempotencyKey;

        const result = await createPublicBooking({
          salonSlug,
          serviceId: selectedServiceId,
          employeeId: selectedEmployeeId,
          idempotencyKey,
          startTime: selectedSlot.startTime,
          customer,
        });

        setBookingResult({ ...result, customer });
      } catch (error) {
        if (error instanceof PublicBookingConflictError) {
          const conflictMessage =
            "Izabrani termin više nije dostupan. Izaberite drugi termin.";
          setBookingError(conflictMessage);
          setSelectedSlot(null);
          idempotencyKeyRef.current = null;
          lastSlotRequestKeyRef.current = null;
          await selectDate(selectedDate);
          setBookingError(conflictMessage);
        } else {
          console.error("Failed to create public booking:", error);
          setBookingError(
            "Rezervaciju trenutno nije moguće kreirati. Pokušajte ponovo."
          );
        }
      } finally {
        creatingBookingRef.current = false;
        setIsCreatingBooking(false);
      }
    },
    [
      salonSlug,
      selectDate,
      selectedDate,
      selectedEmployeeId,
      selectedServiceId,
      selectedSlot,
    ]
  );

  const resetBookingFlow = useCallback(() => {
    creatingBookingRef.current = false;
    idempotencyKeyRef.current = null;
    setBookingResult(null);
    setBookingError(null);
    setCustomerForm(EMPTY_CUSTOMER);
    setIsCreatingBooking(false);
    void selectService(null);
  }, [selectService]);

  const selectSlot = useCallback((slot: PublicAvailabilitySlot | null) => {
    idempotencyKeyRef.current = null;
    setBookingError(null);
    setSelectedSlot(slot);
  }, []);

  return {
    bookingError,
    bookingResult,
    createBooking,
    customerForm,
    employees,
    employeesError,
    employeesLoading,
    isLoadingSlots,
    isCreatingBooking,
    resetBookingFlow,
    selectedDate,
    selectedEmployeeId,
    selectedServiceId,
    selectedSlot,
    selectDate,
    selectEmployee,
    selectService,
    selectSlot,
    slots,
    slotsError,
  };
}
