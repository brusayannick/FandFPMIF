"use client";

import { RotateCcw } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useOnboarding } from "@/lib/stores/onboarding";

export default function AboutPage() {
  const resetOnboarding = useOnboarding((s) => s.reset);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">About ATLAS Hub</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Stat label="Version" value="0.1.0" />
            <Stat label="License" value="MIT" />
            <Stat label="Mode" value="Local-first" />
          </div>
          <p className="text-muted-foreground">
            A local-first, modular process analysis platform. Two services
            (api + web), embedded data stores (SQLite + DuckDB + Parquet), no
            broker, no cloud.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Onboarding</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            Walk through the welcome, upload, and modules steps again. Your
            existing data is untouched.
          </p>
          <Button
            variant="outline"
            className="cursor-pointer gap-2"
            onClick={() => resetOnboarding()}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Restart onboarding
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Diagnostics</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            <em>Copy diagnostics</em> bundles the platform version, module
            list, and recent error excerpts. Implementation lands with the
            module install pipeline (phase 9+).
          </p>
          <Button variant="outline" disabled className="cursor-not-allowed gap-2">
            Copy diagnostics
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  const id = label.toLowerCase();
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </label>
      <input
        id={id}
        readOnly
        value={value}
        className="flex h-9 w-full rounded-md border border-input bg-muted px-3 py-1 text-sm shadow-sm cursor-default select-all text-muted-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
    </div>
  );
}
