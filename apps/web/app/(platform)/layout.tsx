import { Suspense } from "react";

import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";
import { JobsProvider } from "@/components/jobs/jobs-provider";
import { JobsDock } from "@/components/jobs/jobs-dock";
import { JobsDrawer } from "@/components/jobs/jobs-drawer";

export default function PlatformLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Suspense>
          <Topbar />
        </Suspense>
        <main className="min-h-0 flex-1 overflow-auto">{children}</main>
      </div>
      <JobsProvider />
      <JobsDock />
      <JobsDrawer />
    </div>
  );
}
