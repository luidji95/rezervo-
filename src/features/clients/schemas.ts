import { z } from "zod";

export const clientsQuerySchema = z.object({
  salonId: z.string().uuid(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).default(""),
  status: z.enum(["all", "active", "blocked", "archived"]).default("all"),
  sort: z.enum(["newest", "oldest", "name_asc", "name_desc", "most_visits", "highest_spend"]).default("newest"),
});
