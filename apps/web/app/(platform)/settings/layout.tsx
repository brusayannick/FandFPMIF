import { SettingsTabs } from "@/components/settings/settings-tabs";

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <section className="mx-auto max-w-5xl px-6 py-8">
      <header className="space-y-2 pb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Local-first preferences. Changes persist to SQLite and apply live.
        </p>
      </header>
      <SettingsTabs />
      <div className="pt-6">{children}</div>
    </section>
  );
}
