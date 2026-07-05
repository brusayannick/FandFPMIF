"use client";

import dynamic from "next/dynamic";

import { DashboardViewSkeleton } from "./dashboard-view-skeleton";

// Heavy libs (framer-motion, react-grid-layout, recharts, @xyflow/react via the
// viz registry) live in dashboard-view-impl; load them in an async chunk so the
// /dashboards/[id] route's First Load JS stays small. ssr:false because the impl
// only renders a skeleton on the server anyway (data is client-fetched via
// useDashboard) and react-grid-layout's WidthProvider needs real DOM to measure.
const DashboardViewImpl = dynamic(
  () => import("./dashboard-view-impl").then((m) => m.DashboardView),
  { ssr: false, loading: () => <DashboardViewSkeleton /> },
);

export function DashboardView({ dashboardId }: { dashboardId: string }) {
  return <DashboardViewImpl dashboardId={dashboardId} />;
}
