import { z } from "zod";

export const kpiCardSchema = z.object({
  label: z.string(),
  value: z.number(),
  unit: z.string().nullable(),
  delta_percent: z.number().nullable(),
  trend: z.array(z.object({ label: z.string(), value: z.number() })),
});

export const dashboardStatsSchema = z.object({
  generated_at: z.string(),
  total_processes: z.number().int(),
  active_instances: z.number().int(),
  avg_cycle_time_ms: z.number(),
  critical_bottlenecks: z.number().int(),
  module_count: z.number().int(),
  cards: z.array(kpiCardSchema),
});
export type DashboardStats = z.infer<typeof dashboardStatsSchema>;

export const activityItemSchema = z.object({
  id: z.string(),
  type: z.string(),
  title: z.string(),
  subtitle: z.string().nullable(),
  timestamp: z.string(),
});
export type ActivityItem = z.infer<typeof activityItemSchema>;

export const activityFeedSchema = z.object({
  items: z.array(activityItemSchema),
});
