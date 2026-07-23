export type StatisticsPreset =
  | "today"
  | "last_7_days"
  | "this_month"
  | "previous_month"
  | "last_3_months"
  | "this_year"
  | "custom";

export type StatisticsGranularity = "day" | "month";

export type StatisticsPeriodInput = {
  preset: StatisticsPreset;
  customStart?: string;
  customEnd?: string;
};

export type StatisticsPeriod = {
  preset: StatisticsPreset;
  startDate: string;
  endDate: string;
  startUtc: string;
  endUtc: string;
  timezone: string;
  granularity: StatisticsGranularity;
  label: string;
};

export type StatisticsResponse = {
  period: StatisticsPeriod;
  overview: {
    completedRevenue: number;
    completedAppointments: number;
    newClients: number;
    returningClients: number;
    returningVisits: number;
    noShowRate: number;
    currency: string;
  };
  trend: Array<{
    bucket: string;
    revenue: number;
    completedAppointments: number;
  }>;
  appointments: {
    total: number;
    byStatus: {
      pending: number;
      confirmed: number;
      completed: number;
      cancelled: number;
      no_show: number;
    };
    bySource: Array<{ source: string; count: number }>;
  };
  services: Array<{
    serviceKey: string;
    serviceName: string;
    completedCount: number;
    revenue: number;
  }>;
  employees: Array<{
    employeeId: string | null;
    employeeName: string;
    completed: number;
    confirmed: number;
    cancelled: number;
    noShow: number;
    revenue: number;
  }>;
  clients: {
    topClients: Array<{
      clientId: string | null;
      clientName: string;
      completedVisits: number;
      revenue: number;
    }>;
  };
};
