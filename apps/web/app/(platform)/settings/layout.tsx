import { SettingsTabs } from "@/components/settings/settings-tabs";
import { PageContainer, PageTitle, PageDescription } from "@/components/page";

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <PageContainer>
      <header className="space-y-1 pb-6">
        <PageTitle>Settings</PageTitle>
        <PageDescription>
          The Settings tab lets you configure and manage the platform&apos;s
          application, project, and analysis preferences to customize your
          process mining experience.
        </PageDescription>
      </header>
      <SettingsTabs />
      <div className="pt-6">{children}</div>
    </PageContainer>
  );
}
