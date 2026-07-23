export type ClientsSort = "newest" | "oldest" | "name_asc" | "name_desc" | "most_visits" | "highest_spend";
export type ClientsStatus = "all" | "active" | "blocked" | "archived";

export type ClientPageItem = {
  id: string;
  salonId: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  status: Exclude<ClientsStatus, "all">;
  source: string | null;
  createdAt: string;
  completedVisits: number;
  completedRevenue: number;
  lastCompletedVisit: string | null;
  favoriteService: { serviceId: string | null; name: string; count: number } | null;
  recentVisits: Array<{ id: string; startTime: string; serviceName: string; price: number }>;
};

export type ClientsPageResponse = {
  items: ClientPageItem[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  kpis: {
    totalClients: number;
    newClientsThisMonth: number;
    visitsThisMonth: number;
    revenueThisMonth: number;
    clientsWithVisits: number;
    returningClients: number;
    returningClientsPercent: number;
  };
};
