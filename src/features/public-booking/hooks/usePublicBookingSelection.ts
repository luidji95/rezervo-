"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  createPublicBooking,
  getPublicAvailability,
  getPublicEmployeesForService,
  PublicBookingBotCheckError,
  PublicBookingConflictError,
  PublicBookingContactSalonError,
  PublicBookingInvalidPhoneError,
  PublicBookingLimitReachedError,
  PublicBookingProtectionUnavailableError,
  PublicBookingRateLimitedError,
  PublicBookingUnavailableError,
} from "../services/publicBookingService";
import { PHONE_INVALID_MESSAGE } from "@/lib/phone/phoneNumber";
import { createManageToken } from "@/lib/publicBookingManage/manageToken";
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

export type PublicBookingOutcome = "created" | "conflict" | "unavailable" | "invalid_phone" | "contact_salon" | "limit_reached"
  | "rate_limited" | "bot_check_pending" | "bot_check_failed" | "protection_unavailable" | "error" | "ignored";

export const SLOT_CONFLICT_MESSAGE = "Izabrani termin više nije dostupan. Izaberite drugi termin.";
export const CONTACT_SALON_MESSAGE = "Termin trenutno ne možemo zakazati online. Molimo vas da kontaktirate salon.";
export const BOOKING_LIMIT_MESSAGE = "Dostignut je limit za online zakazivanje. Za dodatni termin kontaktirajte salon.";
export const BOT_CHECK_PENDING_MESSAGE = "Sačekajte da se provera završi, pa pokušajte ponovo.";
export const BOT_CHECK_FAILED_MESSAGE = "Nismo uspeli da potvrdimo zahtev. Sačekajte da se provera završi i pokušajte ponovo.";
export const PROTECTION_UNAVAILABLE_MESSAGE = "Zakazivanje trenutno ne možemo da potvrdimo. Pokušajte ponovo za nekoliko trenutaka.";
export function rateLimitedMessage(retryAfterSeconds: number) {
  return `Previše pokušaja zakazivanja. Pokušajte ponovo za ${Math.max(1, Math.ceil(retryAfterSeconds / 60))} min.`;
}

// The date stays selected while the service or employee changes; only the time slot, which belongs to one
// service/employee/date combination, is cleared and availability is loaded again from the server.
export function usePublicBookingSelection(salonId: string, salonSlug: string, initialDate = "", botCheckRequired = false) {
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
  // Generated together with the idempotency key and reset with it: a retry of the same request sends the same token,
  // so a lost response still ends with the same private link.
  const manageTokenRef = useRef<string | null>(null);
  // Turnstile token with its own verification id: a new token always gets a new id, a retry of the same token keeps it.
  // A token is single-use, so after any answer from the server the widget is reset for a fresh one (generation + 1);
  // after a network failure the same token and id are sent again with the same booking key.
  const botCheckRef = useRef<{ token: string; verificationId: string } | null>(null);
  const [botCheckGeneration, setBotCheckGeneration] = useState(0);

  const receiveBotCheckToken = useCallback((token: string | null) => {
    botCheckRef.current = token ? { token, verificationId: crypto.randomUUID() } : null;
  }, []);

  const consumeBotCheck = useCallback(() => {
    botCheckRef.current = null;
    setBotCheckGeneration((generation) => generation + 1);
  }, []);

  useEffect(() => () => slotAbortControllerRef.current?.abort(), []);

  const clearSlotSelection = useCallback(() => {
    setSelectedSlot(null);
    setBookingError(null);
    idempotencyKeyRef.current = null;
    manageTokenRef.current = null;
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
    if (botCheckRequired && !botCheckRef.current) {
      setBookingError(BOT_CHECK_PENDING_MESSAGE);
      return "bot_check_pending";
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
      const manageToken = manageTokenRef.current ?? createManageToken();
      manageTokenRef.current = manageToken;
      const result = await createPublicBooking({
        salonSlug,
        serviceId: selectedServiceId,
        employeeId: selectedEmployeeId,
        idempotencyKey,
        manageToken,
        botCheck: botCheckRequired && botCheckRef.current ? botCheckRef.current : undefined,
        startTime: selectedSlot.startTime,
        customer,
      });
      if (botCheckRequired) consumeBotCheck();
      setBookingResult({ ...result, customer, manageToken: result.manageAccess ? manageToken : null });
      return "created";
    } catch (error) {
      // A fetch TypeError means no answer: the same booking key, private token and bot-check token are retried as they
      // are. Any answer means the bot-check token may be used up, so a fresh one is requested.
      if (botCheckRequired && !(error instanceof TypeError)) consumeBotCheck();
      if (error instanceof PublicBookingRateLimitedError) {
        setBookingError(rateLimitedMessage(error.retryAfterSeconds));
        return "rate_limited";
      }
      if (error instanceof PublicBookingBotCheckError) {
        setBookingError(BOT_CHECK_FAILED_MESSAGE);
        return "bot_check_failed";
      }
      if (error instanceof PublicBookingProtectionUnavailableError) {
        setBookingError(PROTECTION_UNAVAILABLE_MESSAGE);
        return "protection_unavailable";
      }
      if (error instanceof PublicBookingConflictError) {
        setSelectedSlot(null);
        idempotencyKeyRef.current = null;
        manageTokenRef.current = null;
        await loadSlots({ force: true });
        setBookingError(SLOT_CONFLICT_MESSAGE);
        return "conflict";
      }
      if (error instanceof PublicBookingContactSalonError) {
        // Neutral on purpose: it must not reveal anything about the salon's existing clients. Nothing was written.
        setBookingError(CONTACT_SALON_MESSAGE);
        return "contact_salon";
      }
      if (error instanceof PublicBookingLimitReachedError) {
        // Nothing was written; the selection and the entered details stay on screen.
        setBookingError(BOOKING_LIMIT_MESSAGE);
        return "limit_reached";
      }
      if (error instanceof PublicBookingInvalidPhoneError) {
        // Nothing was written; the same key can be reused once the number is corrected.
        setBookingError(PHONE_INVALID_MESSAGE);
        return "invalid_phone";
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
  }, [botCheckRequired, consumeBotCheck, loadSlots, salonSlug, selectedDate, selectedEmployeeId, selectedServiceId, selectedSlot]);

  const resetBookingFlow = useCallback(() => {
    creatingBookingRef.current = false;
    idempotencyKeyRef.current = null;
    manageTokenRef.current = null;
    setBookingResult(null);
    setBookingError(null);
    setCustomerForm(EMPTY_CUSTOMER);
    setIsCreatingBooking(false);
    if (botCheckRequired) consumeBotCheck();
    void selectService(null);
  }, [botCheckRequired, consumeBotCheck, selectService]);

  const selectSlot = useCallback((slot: PublicAvailabilitySlot | null) => {
    idempotencyKeyRef.current = null;
    manageTokenRef.current = null;
    setBookingError(null);
    setSelectedSlot(slot);
  }, []);

  return {
    botCheckGeneration,
    receiveBotCheckToken,
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
