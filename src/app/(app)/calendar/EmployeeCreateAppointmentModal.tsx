"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";

import {
  optionalEmailSchema,
  optionalPhoneSchema,
  requiredStringSchema,
} from "@/lib/validation/commonSchemas";
import { DEFAULT_SALON_TIME_ZONE, getTodayDateKey } from "@/lib/salonDateTime";
import {
  createOwnAppointment,
  EmployeeCreateAppointmentError,
  getEmployeeAvailableSlots,
  getEmployeeCreateServices,
  type EmployeeCreateServiceOption,
} from "@/services/employeeAppointmentCreateService";
import type { AvailableSlot } from "@/types/availability";

const schema = z
  .object({
    serviceId: z.string().uuid("Izaberite uslugu."),
    startTime: z.string().datetime({ offset: true }),
    fullName: requiredStringSchema("Ime i prezime", 2, 120),
    phone: optionalPhoneSchema,
    email: optionalEmailSchema,
    note: z.string().trim().max(1000).optional(),
  })
  .superRefine((value, context) => {
    if (!value.phone && !value.email) {
      context.addIssue({ code: "custom", path: ["phone"], message: "Unesite telefon ili email." });
    }
  });

type FormValues = z.infer<typeof schema>;

type Props = {
  isOpen: boolean;
  onClose: () => void;
  selectedDate: string;
  salonTimeZone?: string | null;
  onCreated: () => Promise<void>;
};

const errorMessages: Record<string, string> = {
  SERVICE_NOT_ASSIGNED: "Izabrana usluga vam nije dodeljena.",
  SLOT_UNAVAILABLE: "Izabrani termin više nije dostupan. Izaberite drugi termin.",
  APPOINTMENT_CONFLICT: "Izabrani termin više nije dostupan. Izaberite drugi termin.",
  CLIENT_CONFLICT: "Telefon i email pripadaju različitim klijentima.",
  IDEMPOTENCY_CONFLICT: "Ovaj pokušaj je već iskorišćen. Započnite novi termin.",
  UNAUTHORIZED: "Morate biti prijavljeni.",
};

export default function EmployeeCreateAppointmentModal({
  isOpen,
  onClose,
  selectedDate,
  salonTimeZone,
  onCreated,
}: Props) {
  const [services, setServices] = useState<EmployeeCreateServiceOption[]>([]);
  const [slots, setSlots] = useState<AvailableSlot[]>([]);
  const [date, setDate] = useState(selectedDate);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [serverError, setServerError] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const { register, control, handleSubmit, setValue, reset, formState: { errors, isSubmitting } } =
    useForm<FormValues>({
      resolver: zodResolver(schema),
      defaultValues: { serviceId: "", startTime: "", fullName: "", phone: "", email: "", note: "" },
    });
  const serviceId = useWatch({ control, name: "serviceId" });
  const startTime = useWatch({ control, name: "startTime" });
  const selectedService = services.find((service) => service.id === serviceId);

  useEffect(() => {
    if (!isOpen) return;
    void getEmployeeCreateServices()
      .then(setServices)
      .catch(() => setServerError("Usluge trenutno nisu dostupne."));
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !serviceId || !date) return;
    let active = true;
    async function loadSlots() {
      setLoadingSlots(true);
      setSlots([]);
      setServerError("");
      setValue("startTime", "");
      try {
        const result = await getEmployeeAvailableSlots(serviceId, date);
        if (active) setSlots(result);
      } catch {
        if (active) setServerError("Slobodni termini trenutno nisu dostupni.");
      } finally {
        if (active) setLoadingSlots(false);
      }
    }
    void loadSlots();
    return () => { active = false; };
  }, [date, isOpen, serviceId, setValue]);

  if (!isOpen) return null;

  const close = () => {
    if (isSubmitting) return;
    reset();
    setSlots([]);
    setIdempotencyKey(crypto.randomUUID());
    onClose();
  };

  const submit = async (values: FormValues) => {
    setServerError("");
    try {
      await createOwnAppointment({
        serviceId: values.serviceId,
        startTime: values.startTime,
        customer: { fullName: values.fullName, phone: values.phone, email: values.email },
        note: values.note,
        idempotencyKey,
      });
      await onCreated();
      window.dispatchEvent(new Event("rezervo:appointment-created"));
      reset();
      setSlots([]);
      setIdempotencyKey(crypto.randomUUID());
      onClose();
    } catch (error) {
      const code = error instanceof EmployeeCreateAppointmentError ? error.code : "CREATE_FAILED";
      setServerError(errorMessages[code] ?? "Termin trenutno nije moguće kreirati.");
      if (code === "SLOT_UNAVAILABLE" || code === "APPOINTMENT_CONFLICT") {
        setValue("startTime", "");
        const fresh = await getEmployeeAvailableSlots(values.serviceId, date).catch(() => []);
        setSlots(fresh);
      }
    }
  };

  return (
    <div className="modal-overlay" onClick={close}>
      <div className="modal-container" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <h2>Novi termin</h2>
          <button type="button" className="btn-close-modal" onClick={close} disabled={isSubmitting}>&times;</button>
        </div>
        <form className="modal-form" onSubmit={handleSubmit(submit)}>
          <div className="form-section-title">Usluga i vreme</div>
          <div className="form-group">
            <label>Usluga *</label>
            <select {...register("serviceId")}>
              <option value="">Izaberite uslugu...</option>
              {services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}
            </select>
            {errors.serviceId && <span className="error-text">{errors.serviceId.message}</span>}
          </div>
          {selectedService && <p>{selectedService.durationMinutes} min · {selectedService.price} {selectedService.currency}</p>}
          <div className="form-group">
            <label>Datum *</label>
            <input type="date" min={getTodayDateKey(salonTimeZone || DEFAULT_SALON_TIME_ZONE)} value={date} onChange={(event) => setDate(event.target.value)} />
          </div>
          <div className="form-group">
            <label>Slobodni termini *</label>
            {loadingSlots && <p>Učitavam termine...</p>}
            {!loadingSlots && serviceId && slots.length === 0 && <p>Nema slobodnih termina za ovaj datum.</p>}
            <div className="slots-grid">
              {slots.map((slot) => (
                <button key={slot.startTime} type="button" className={`slot-button ${startTime === slot.startTime ? "slot-button-active" : ""}`} onClick={() => setValue("startTime", slot.startTime, { shouldValidate: true })}>
                  {new Date(slot.startTime).toLocaleTimeString("sr-RS", { hour: "2-digit", minute: "2-digit", timeZone: salonTimeZone || DEFAULT_SALON_TIME_ZONE })}
                </button>
              ))}
            </div>
            {errors.startTime && <span className="error-text">Izaberite termin.</span>}
          </div>
          <div className="form-section-title">Podaci klijenta</div>
          <div className="form-group"><label>Ime i prezime *</label><input {...register("fullName")} />{errors.fullName && <span className="error-text">{errors.fullName.message}</span>}</div>
          <div className="form-row">
            <div className="form-group"><label>Telefon</label><input {...register("phone")} />{errors.phone && <span className="error-text">{errors.phone.message}</span>}</div>
            <div className="form-group"><label>Email</label><input type="email" {...register("email")} />{errors.email && <span className="error-text">{errors.email.message}</span>}</div>
          </div>
          <div className="form-group"><label>Napomena</label><textarea rows={2} {...register("note")} /></div>
          {selectedService && startTime && (
            <div className="form-group">
              <strong>Pregled termina</strong>
              <p>{selectedService.name} · {selectedService.durationMinutes} min · {selectedService.price} {selectedService.currency}</p>
              <p>{date} u {new Date(startTime).toLocaleTimeString("sr-RS", { hour: "2-digit", minute: "2-digit", timeZone: salonTimeZone || DEFAULT_SALON_TIME_ZONE })}</p>
            </div>
          )}
          {serverError && <p className="error-text">{serverError}</p>}
          <div className="modal-actions">
            <button type="button" className="btn-modal-secondary" onClick={close} disabled={isSubmitting}>Otkaži</button>
            <button type="submit" className="btn-modal-primary" disabled={isSubmitting || !startTime}>{isSubmitting ? "Čuvanje..." : "Zakaži termin"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
