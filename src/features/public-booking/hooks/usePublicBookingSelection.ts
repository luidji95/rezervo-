"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  createPublicBooking,
  getPublicAvailability,
  getPublicEmployeesForService,
  PublicBookingConflictError,
  PublicBookingUnavailableError,
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
  note: "",
};

export type PublicBookingOutcome = "created" | "conflict" | "unavailable" | "error" | "ignored";

export const SLOT_CONFLICT_MESSAGE = "Izabrani termin više nije dostupan. Izaberite drugi termin.";

// The date stays selected while the service or employee changes; only the time slot, which belongs to one
// service/employee/date combination, is cleared and availability is loaded again from the server.
export function usePublicBookingSelection(salonId: string, salonSlug: string, initialDate = "") {
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<PublicEmployeeSelection>(null);
  const [employees, setEmployees] = useState<PublicEmployee[]>([]);
  const [employeesLoading, setEmployeesLoading] = useState(false);
  const [employeesError, setEmployeesError] = useState(false);
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [slots, setSlots] = useState<PublicAvailabilitySlot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<PublicAvailabilitySlot | null>(null);
  const [isLoadingSlots, setIsLoadingSlots] = useState(false);
  const [slotsError, setSlotsError] = useState(false);
  const [customerForm, setCustomerForm] = useState<PublicCustomerData>(EMPTY_CUSTOMER);
  const [isCreatingBooking, setIsCreatingBooking] = useState(false);
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [bookingResult, setBookingResult] = useState<PublicBookingResult | null>(null);
  const serviceRef = useRef<string | null>(null);
  const employeeRef = useRef<PublicEmployeeSelection>(null);
  const dateRef = useRef(initialDate);
  const employeeRequestIdRef = useRef(0);
  const slotRequestIdRef = useRef(0);
  const slotAbortControllerRef = useRef<AbortController | null>(null);
  const lastSlotRequestKeyRef = useRef<string | null>(null);
  const creatingBookingRef = useRef(false);
  const idempotencyKeyRef = useRef<string | null>(null);

  useEffect(() => () => slotAbortControllerRef.current?.abort(), []);

  const clearSlotSelection = useCallback(() => {
    setSelectedSlot(null);
    setBookingError(null);
    idempotencyKeyRef.current = null;
  }, []);

  const loadSlots = useCallback(async ({ force = false } = {}) => {
    const serviceId = serviceRef.current;
    const employeeId = employeeRef.current;
    const date = dateRef.current;
    const canLoad = Boolean(date && serviceId && employeeId) && employeeId !== "any";
    const requestKey = canLoad ? [salonId, serviceId, employeeId, date].join(":") : null;
    if (!force && requestKey && lastSlotRequestKeyRef.current === requestKey) return;

    slotRequestIdRef.current += 1;
    const requestId = slotRequestIdRef.current;
    slotAbortControllerRef.current?.abort();
    slotAbortControllerRef.current = null;
    setSlots([]);
    setSlotsError(false);

    if (!canLoad || !requestKey || !serviceId || !employeeId || employeeId === "any") {
      lastSlotRequestKeyRef.current = null;
      setIsLoadingSlots(false);
      return;
    }

    lastSlotRequestKeyRef.current = requestKey;
    const controller = new AbortController();
    slotAbortControllerRef.current = controller;
    setIsLoadingSlots(true);
    try {
      const nextSlots = await getPublicAvailability({ salonId, serviceId, employeeId, date }, controller.signal);
      if (slotRequestIdRef.current === requestId) setSlots(nextSlots);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
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
  }, [salonId]);

  const selectService = useCallback(async (serviceId: string | null) => {
    const requestId = employeeRequestIdRef.current + 1;
    employeeRequestIdRef.current = requestId;
    serviceRef.current = serviceId;
    employeeRef.current = null;
    setSelectedServiceId(serviceId);
    setSelectedEmployeeId(null);
    setEmployees([]);
    setEmployeesError(false);
    clearSlotSelection();
    void loadSlots();

    if (!serviceId) {
      setEmployeesLoading(false);
      return;
    }
    setEmployeesLoading(true);
    try {
      const nextEmployees = await getPublicEmployeesForService(salonId, serviceId);
      if (employeeRequestIdRef.current !== requestId) return;
      setEmployees(nextEmployees);
      if (nextEmployees.length === 1) {
        // Only one employee performs this service: select automatically and load the kept date.
        employeeRef.current = nextEmployees[0].id;
        setSelectedEmployeeId(nextEmployees[0].id);
        void loadSlots();
      }
    } catch (error) {
      console.error("Failed to load employees for public booking:", error);
      if (employeeRequestIdRef.current === requestId) setEmployeesError(true);
    } finally {
      if (employeeRequestIdRef.current === requestId) setEmployeesLoading(false);
    }
  }, [clearSlotSelection, loadSlots, salonId]);

  const retryEmployees = useCallback(() => {
    if (serviceRef.current) void selectService(serviceRef.current);
  }, [selectService]);

  const selectEmployee = useCallback((employeeId: PublicEmployeeSelection) => {
    employeeRef.current = employeeId;
    setSelectedEmployeeId(employeeId);
    clearSlotSelection();
    void loadSlots();
  }, [clearSlotSelection, loadSlots]);

  const selectDate = useCallback(async (date: string) => {
    if (date === dateRef.current && lastSlotRequestKeyRef.current) return;
    dateRef.current = date;
    setSelectedDate(date);
    clearSlotSelection();
    await loadSlots();
  }, [clearSlotSelection, loadSlots]);

  const retrySlots = useCallback(() => loadSlots({ force: true }), [loadSlots]);

  const createBooking = useCallback(async (customer: PublicCustomerData): Promise<PublicBookingOutcome> => {
    if (creatingBookingRef.current || !selectedServiceId || !selectedEmployeeId || selectedEmployeeId === "any" || !selectedSlot || !selectedDate) {
      return "ignored";
    }
    creatingBookingRef.current = true;
    setCustomerForm(customer);
    setIsCreatingBooking(true);
    setBookingError(null);

    try {
      // The same key is reused until the selection changes or the slot is reported taken, so a retry after a
      // network failure or 503 BOOKING_RETRY can never create a second appointment.
      const idempotencyKey = idempotencyKeyRef.current ?? crypto.randomUUID();
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
      return "created";
    } catch (error) {
      if (error instanceof PublicBookingConflictError) {
        setSelectedSlot(null);
        idempotencyKeyRef.current = null;
        await loadSlots({ force: true });
        setBookingError(SLOT_CONFLICT_MESSAGE);
        return "conflict";
      }
      if (error instanceof PublicBookingUnavailableError) {
        setBookingError("Online zakazivanje trenutno nije dostupno.");
        setSelectedSlot(null);
        return "unavailable";
      }
      console.error("Failed to create public booking:", error);
      setBookingError("Termin trenutno nije moguće zakazati. Pokušajte ponovo.");
      return "error";
    } finally {
      creatingBookingRef.current = false;
      setIsCreatingBooking(false);
    }
  }, [loadSlots, salonSlug, selectedDate, selectedEmployeeId, selectedServiceId, selectedSlot]);

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
    retryEmployees,
    retrySlots,
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
