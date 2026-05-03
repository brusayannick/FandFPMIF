"use client";

import { useTheme } from "next-themes";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import {
  RadioGroup,
  RadioGroupItem,
} from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { useUi } from "@/lib/stores/ui";

export default function GeneralSettingsPage() {
  const { theme = "system", setTheme } = useTheme();
  const density = useUi((s) => s.density);
  const setDensity = useUi((s) => s.setDensity);
  const muted = useUi((s) => s.notificationsMuted);
  const setMuted = useUi((s) => s.setNotificationsMuted);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label>Theme</Label>
            <RadioGroup
              value={theme}
              onValueChange={setTheme}
              className="flex gap-3"
            >
              {(["light", "dark", "system"] as const).map((t) => (
                <Label
                  key={t}
                  className="flex cursor-pointer items-center gap-2 rounded-md border border-border bg-card px-3 py-2 capitalize text-sm has-[input:checked]:border-primary"
                >
                  <RadioGroupItem value={t} />
                  {t}
                </Label>
              ))}
            </RadioGroup>
          </div>

          <div className="space-y-2">
            <Label>Density</Label>
            <RadioGroup
              value={density}
              onValueChange={(v) => setDensity(v as "comfortable" | "compact")}
              className="flex gap-3"
            >
              {(["comfortable", "compact"] as const).map((d) => (
                <Label
                  key={d}
                  className="flex cursor-pointer items-center gap-2 rounded-md border border-border bg-card px-3 py-2 capitalize text-sm has-[input:checked]:border-primary"
                >
                  <RadioGroupItem value={d} />
                  {d}
                </Label>
              ))}
            </RadioGroup>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Notifications</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Label className="flex items-center justify-between gap-3">
            <span className="space-y-0.5">
              <span className="block text-sm">Mute non-error toasts</span>
              <span className="block text-xs text-muted-foreground">
                Errors always toast. Successes and queue notices stay quiet.
              </span>
            </span>
            <Switch checked={muted} onCheckedChange={setMuted} className="cursor-pointer" />
          </Label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Jobs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Label>Worker concurrency</Label>
            <p className="text-xs text-muted-foreground">
              Backend setting — change <code className="rounded bg-muted px-1 text-[11px]">WORKER_CONCURRENCY</code> in
              the API env and restart. The slider below is a placeholder for the
              live-update path that lands with the settings sync (phase 9+).
            </p>
            <Slider defaultValue={[2]} min={1} max={8} step={1} disabled className="cursor-not-allowed" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Telemetry</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Off by default. The platform is local-first; no telemetry is collected
          without consent. (Opt-in switch lands when the telemetry pipeline does.)
        </CardContent>
      </Card>
    </div>
  );
}
