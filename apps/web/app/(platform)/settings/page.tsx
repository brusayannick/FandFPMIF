import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function SettingsPage() {
  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="mt-1 text-sm text-text-muted">
            Platform, workspace, and account configuration.
          </p>
        </header>

        <Card className="bg-surface">
          <CardHeader>
            <CardTitle className="text-base">Coming soon</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-text-muted">
            Workspace settings, API keys, and user preferences will be wired up
            in a later phase.
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
