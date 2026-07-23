export type EmployeeAppointmentCurrentStatus =
  | "pending"
  | "confirmed"
  | "completed"
  | "cancelled"
  | "no_show";

export type EmployeeAppointmentNextStatus = Exclude<
  EmployeeAppointmentCurrentStatus,
  "pending"
>;

export type EmployeeAppointmentStatusAction = {
  nextStatus: EmployeeAppointmentNextStatus;
  label: string;
  loadingLabel: string;
  tone: "primary" | "warning" | "danger";
  requiresConfirmation: boolean;
  confirmationTitle?: string;
  confirmationMessage?: string;
};

export const EMPLOYEE_APPOINTMENT_STATUS_LABELS: Record<
  EmployeeAppointmentCurrentStatus,
  string
> = {
  pending: "Na čekanju",
  confirmed: "Potvrđeno",
  completed: "Završeno",
  cancelled: "Otkazano",
  no_show: "Nije došao",
};

export const EMPLOYEE_APPOINTMENT_STATUS_TRANSITIONS: Record<
  EmployeeAppointmentCurrentStatus,
  readonly EmployeeAppointmentStatusAction[]
> = {
  pending: [
    {
      nextStatus: "confirmed",
      label: "Potvrdi termin",
      loadingLabel: "Potvrđujem...",
      tone: "primary",
      requiresConfirmation: false,
    },
    {
      nextStatus: "cancelled",
      label: "Otkaži termin",
      loadingLabel: "Otkazujem...",
      tone: "danger",
      requiresConfirmation: true,
      confirmationTitle: "Otkaži termin",
      confirmationMessage: "Da li ste sigurni da želite da otkažete ovaj termin?",
    },
  ],
  confirmed: [
    {
      nextStatus: "completed",
      label: "Završi termin",
      loadingLabel: "Završavam...",
      tone: "primary",
      requiresConfirmation: false,
    },
    {
      nextStatus: "no_show",
      label: "Nije došao",
      loadingLabel: "Čuvam...",
      tone: "warning",
      requiresConfirmation: true,
      confirmationTitle: "Klijent nije došao",
      confirmationMessage: "Označiti da klijent nije došao?",
    },
    {
      nextStatus: "cancelled",
      label: "Otkaži termin",
      loadingLabel: "Otkazujem...",
      tone: "danger",
      requiresConfirmation: true,
      confirmationTitle: "Otkaži termin",
      confirmationMessage: "Da li ste sigurni da želite da otkažete ovaj termin?",
    },
  ],
  completed: [],
  cancelled: [],
  no_show: [],
};

const FINAL_MESSAGES: Record<
  Exclude<EmployeeAppointmentCurrentStatus, "pending" | "confirmed">,
  string
> = {
  completed: "Termin je završen.",
  cancelled: "Termin je otkazan.",
  no_show: "Klijent nije došao.",
};

export function normalizeEmployeeAppointmentStatus(
  status: string,
): EmployeeAppointmentCurrentStatus | null {
  return status in EMPLOYEE_APPOINTMENT_STATUS_TRANSITIONS
    ? (status as EmployeeAppointmentCurrentStatus)
    : null;
}

export function getEmployeeAppointmentStatusActions(status: string) {
  const normalized = normalizeEmployeeAppointmentStatus(status);
  return normalized ? EMPLOYEE_APPOINTMENT_STATUS_TRANSITIONS[normalized] : [];
}

export function getEmployeeAppointmentStatusLabel(status: string) {
  const normalized = normalizeEmployeeAppointmentStatus(status);
  return normalized ? EMPLOYEE_APPOINTMENT_STATUS_LABELS[normalized] : status;
}

export function getEmployeeAppointmentFinalMessage(status: string) {
  const normalized = normalizeEmployeeAppointmentStatus(status);
  return normalized && normalized in FINAL_MESSAGES
    ? FINAL_MESSAGES[normalized as keyof typeof FINAL_MESSAGES]
    : null;
}
