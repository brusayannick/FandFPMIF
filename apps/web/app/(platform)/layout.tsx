import { Suspense } from "react";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";
import { JobsProvider } from "@/components/jobs/jobs-provider";
import { JobsDock } from "@/components/jobs/jobs-dock";
import { JobsDrawer } from "@/components/jobs/jobs-drawer";
import { OnboardingOverlay } from "@/components/onboarding";
import { MateAiSidebar } from "@/components/mate-ai/mate-ai-sidebar";

export default async function PlatformLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session) {
    redirect("/login");
  }
  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Sidebar isAdmin={session.user.isAdmin === true} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Suspense>
          <Topbar />
        </Suspense>
        <main className="min-h-0 flex-1 overflow-auto">{children}</main>
      </div>
      <MateAiSidebar />
      <JobsProvider />
      <JobsDock />
      <JobsDrawer />
      <OnboardingOverlay />
    </div>
  );
}
