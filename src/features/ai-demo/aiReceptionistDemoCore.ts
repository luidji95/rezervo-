// Interactive demo of the future AI receptionist. Everything here is a local simulation with prepared answers:
// no model, no messaging integration, no booking. The salon, staff, slots and contact details are invented.

export const DEMO_TIME_ZONE = "Europe/Belgrade";

export const DEMO_SALON = { name: "Studio Lavanda" } as const;
export const DEMO_SERVICE = { name: "Šišanje", durationMinutes: 45, priceRsd: 1800 } as const;
// Invented contact details that the visitor only confirms; nothing personal is typed in.
export const DEMO_CONTACT = { name: "Jelena Demo", phone: "060 000 0000" } as const;

export type EmployeeId = "ana" | "marko";
export const DEMO_EMPLOYEES: Record<EmployeeId, { name: string; withName: string }> = {
  ana: { name: "Ana", withName: "kod Ane" },
  marko: { name: "Marko", withName: "kod Marka" },
};

// Free slots tomorrow (salon local time). The calendar shows the busy blocks around them.
export const DEMO_SLOTS: Record<EmployeeId, string[]> = {
  ana: ["10:00", "13:30", "17:00"],
  marko: ["11:15", "15:45"],
};
export const DEMO_BUSY: Record<EmployeeId, Array<{ start: string; end: string; label: string }>> = {
  ana: [{ start: "09:00", end: "10:00", label: "Feniranje" }, { start: "11:00", end: "13:00", label: "Bojenje" }, { start: "15:00", end: "16:30", label: "Šišanje" }],
  marko: [{ start: "09:30", end: "11:00", label: "Šišanje i brada" }, { start: "12:30", end: "15:00", label: "Bojenje" }, { start: "17:00", end: "18:00", label: "Šišanje" }],
};

export type DemoStep = "start" | "employee" | "slot" | "contact" | "review" | "done";
export type DemoSlot = { time: string; employeeId: EmployeeId };
export type DemoMessage = { id: number; from: "client" | "receptionist"; text: string };
export type DemoChoice = { id: string; label: string };
export type DemoDay = { dateKey: string; label: string };

export type DemoState = {
  step: DemoStep;
  day: DemoDay;
  employeeChoice: EmployeeId | "any" | null;
  slot: DemoSlot | null;
  priceAsked: boolean;
  messages: DemoMessage[];
};

export type DemoBooking = {
  salon: string;
  service: string;
  employeeId: EmployeeId;
  employeeName: string;
  dateKey: string;
  dayLabel: string;
  time: string;
  endTime: string;
  durationMinutes: number;
  priceRsd: number;
  contact: typeof DEMO_CONTACT;
};

const WEEKDAYS = ["nedelja", "ponedeljak", "utorak", "sreda", "četvrtak", "petak", "subota"];
const MONTHS = ["januara", "februara", "marta", "aprila", "maja", "juna", "jula", "avgusta", "septembra", "oktobra", "novembra", "decembra"];

// "Sutra" is the calendar day after today in Europe/Belgrade, independent of the visitor's own time zone.
export function tomorrowInBelgrade(now: Date): DemoDay {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: DEMO_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  const date = new Date(Date.UTC(read("year"), read("month") - 1, read("day") + 1));
  const dateKey = date.toISOString().slice(0, 10);
  return { dateKey, label: `${WEEKDAYS[date.getUTCDay()]}, ${date.getUTCDate()}. ${MONTHS[date.getUTCMonth()]}` };
}

export function formatPrice(rsd: number) {
  return `${rsd.toLocaleString("sr-Latn-RS").replace(/\s/g, ".")} RSD`;
}

export function addMinutes(time: string, minutes: number) {
  const [hours, mins] = time.split(":").map(Number);
  const total = hours * 60 + mins + minutes;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function availableSlots(choice: EmployeeId | "any" | null): DemoSlot[] {
  if (choice === "ana" || choice === "marko") return DEMO_SLOTS[choice].map((time) => ({ time, employeeId: choice }));
  return (Object.keys(DEMO_SLOTS) as EmployeeId[])
    .flatMap((employeeId) => DEMO_SLOTS[employeeId].map((time) => ({ time, employeeId })))
    .sort((a, b) => a.time.localeCompare(b.time))
    .slice(0, 3);
}

const slotId = (slot: DemoSlot) => `slot:${slot.employeeId}:${slot.time}`;

function priceText() {
  return `${DEMO_SERVICE.name} traje ${DEMO_SERVICE.durationMinutes} minuta i košta ${formatPrice(DEMO_SERVICE.priceRsd)}.`;
}

function slotQuestion(state: DemoState) {
  const who = state.employeeChoice === "ana" || state.employeeChoice === "marko" ? `${DEMO_EMPLOYEES[state.employeeChoice].name} ima` : "Imamo";
  return `${who} slobodne termine sutra, ${state.day.label}. Koje vreme vam odgovara?`;
}

export function createDemoState(now: Date): DemoState {
  return {
    step: "start",
    day: tomorrowInBelgrade(now),
    employeeChoice: null,
    slot: null,
    priceAsked: false,
    messages: [{ id: 1, from: "receptionist", text: `Zdravo! Ovde AI recepcionista salona ${DEMO_SALON.name}. Kako mogu da pomognem?` }],
  };
}

export function getDemoChoices(state: DemoState): DemoChoice[] {
  switch (state.step) {
    case "start":
      return [{ id: "ask-haircut", label: "Imate li slobodno za šišanje sutra?" }];
    case "employee":
      return [
        { id: "employee:ana", label: DEMO_EMPLOYEES.ana.name },
        { id: "employee:marko", label: DEMO_EMPLOYEES.marko.name },
        { id: "employee:any", label: "Svejedno mi je" },
      ];
    case "slot": {
      const slots = availableSlots(state.employeeChoice).map((slot) => ({
        id: slotId(slot),
        label: state.employeeChoice === "any" ? `${slot.time} (${DEMO_EMPLOYEES[slot.employeeId].name})` : slot.time,
      }));
      return state.priceAsked ? slots : [...slots, { id: "ask-price", label: "Koliko košta?" }];
    }
    case "contact":
      return [{ id: "contact-ok", label: "Da, podaci su tačni" }, { id: "change-time", label: "Izaberi drugo vreme" }];
    case "review":
      return [{ id: "confirm", label: "Potvrdi termin" }, { id: "change-time", label: "Izaberi drugo vreme" }];
    case "done":
      return [];
  }
}

export function getDemoBooking(state: DemoState): DemoBooking | null {
  if (!state.slot) return null;
  const employee = DEMO_EMPLOYEES[state.slot.employeeId];
  return {
    salon: DEMO_SALON.name,
    service: DEMO_SERVICE.name,
    employeeId: state.slot.employeeId,
    employeeName: employee.name,
    dateKey: state.day.dateKey,
    dayLabel: state.day.label,
    time: state.slot.time,
    endTime: addMinutes(state.slot.time, DEMO_SERVICE.durationMinutes),
    durationMinutes: DEMO_SERVICE.durationMinutes,
    priceRsd: DEMO_SERVICE.priceRsd,
    contact: DEMO_CONTACT,
  };
}

export function describeBooking(booking: DemoBooking) {
  return `${booking.service} ${DEMO_EMPLOYEES[booking.employeeId].withName}, sutra (${booking.dayLabel}) u ${booking.time}, ${booking.durationMinutes} min, ${formatPrice(booking.priceRsd)}`;
}

// Applies one visitor choice. Unknown or stale choices (for example a double click on an option that is no longer
// offered) return the same state object, so the caller can ignore them.
export function chooseDemoOption(state: DemoState, choiceId: string): DemoState {
  const choice = getDemoChoices(state).find((item) => item.id === choiceId);
  if (!choice) return state;
  let nextId = (state.messages.at(-1)?.id ?? 0) + 1;
  const say = (from: DemoMessage["from"], text: string): DemoMessage => ({ id: nextId++, from, text });
  const client = say("client", choice.label);

  if (state.step === "start") {
    return { ...state, step: "employee", messages: [...state.messages, client, say("receptionist", `Naravno! Kod koga biste želeli da zakažete šišanje?`)] };
  }
  if (state.step === "employee") {
    const employeeChoice = choiceId.slice("employee:".length) as EmployeeId | "any";
    const next = { ...state, step: "slot" as const, employeeChoice, slot: null };
    return { ...next, messages: [...state.messages, client, say("receptionist", slotQuestion(next))] };
  }
  if (state.step === "slot" && choiceId === "ask-price") {
    return { ...state, priceAsked: true, messages: [...state.messages, client, say("receptionist", `${priceText()} Koji termin da rezervišem?`)] };
  }
  if (state.step === "slot") {
    const slot = availableSlots(state.employeeChoice).find((item) => slotId(item) === choiceId);
    if (!slot) return state;
    const employee = DEMO_EMPLOYEES[slot.employeeId];
    return {
      ...state, step: "contact", slot,
      messages: [...state.messages, client, say("receptionist", `Odlično, ${slot.time} ${employee.withName}. Da li da termin zakažem na ime ${DEMO_CONTACT.name}, broj ${DEMO_CONTACT.phone}?`)],
    };
  }
  if ((state.step === "contact" || state.step === "review") && choiceId === "change-time") {
    const next = { ...state, step: "slot" as const, slot: null };
    return { ...next, messages: [...state.messages, client, say("receptionist", slotQuestion(next))] };
  }
  if (state.step === "contact") {
    const booking = getDemoBooking(state)!;
    return { ...state, step: "review", messages: [...state.messages, client, say("receptionist", `Pregled: ${describeBooking(booking)}. Da li da potvrdim termin?`)] };
  }
  if (state.step === "review") {
    const booking = getDemoBooking(state)!;
    return {
      ...state, step: "done",
      messages: [...state.messages, client, say("receptionist", `Termin je zakazan: sutra u ${booking.time} ${DEMO_EMPLOYEES[booking.employeeId].withName}. Vidimo se!`)],
    };
  }
  return state;
}
