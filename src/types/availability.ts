export type GenerateAvailableSlotsInput = {
  salonId: string;
  serviceId: string;
  employeeId?: string;
  date: string; // format: "2026-05-10"
};

export type AvailableSlot = {
  startTime: string;
  endTime: string;
  employeeId: string;
};

export type GenerateAvailableSlotsResult = {
  slots: AvailableSlot[];
};