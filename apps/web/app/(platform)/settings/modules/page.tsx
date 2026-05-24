"use client";

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { Check, Copy, Download, ExternalLink, FileBox, Plus } from "lucide-react";
import { useModules } from "@/lib/queries";

const SCIEBO_URL = "https://uni-muenster.sciebo.de/s/LJGB3dPEdsEp9zZ";
const SCIEBO_PASSWORD = "FlowFactory";

function DefaultModulesCard() {
  const [copied, setCopied] = useState(false);

  const copyPassword = async () => {
    try {
      await navigator.clipboard.writeText(SCIEBO_PASSWORD);
      setCopied(true);
      toast.success("Password copied");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy — select and copy manually");
    }
  };

  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Download className="h-4 w-4" />
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-semibold">Install default modules</h3>
            <p className="text-xs text-muted-foreground">
              Default modules aren&apos;t bundled with the app. Download the
              module archives from Sciebo, then upload each <code className="rounded bg-muted px-1 text-[11px]">.zip</code> below.
            </p>
          </div>
        </div>

        <ol className="space-y-2 text-xs text-muted-foreground">
          <li className="flex gap-2">
            <span className="font-medium text-foreground">1.</span>
            <span>
              Open the Sciebo folder and enter the password to access the
              archives.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="font-medium text-foreground">2.</span>
            <span>Download the module <code className="rounded bg-muted px-1 text-[11px]">.zip</code> files you want.</span>
          </li>
          <li className="flex gap-2">
            <span className="font-medium text-foreground">3.</span>
            <span>
              Click <span className="font-medium text-foreground">Install a module</span> and upload each archive.
            </span>
          </li>
        </ol>

        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/30 p-3">
          <span className="text-xs text-muted-foreground">Password:</span>
          <code className="rounded bg-background px-2 py-0.5 text-xs font-mono">{SCIEBO_PASSWORD}</code>
          <Button
            variant="ghost"
            size="sm"
            onClick={copyPassword}
            className="ml-auto h-7 cursor-pointer gap-1.5 text-xs"
          >
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="sm" className="cursor-pointer">
            <a href={SCIEBO_URL} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
              Open Sciebo folder
            </a>
          </Button>
          <Button asChild size="sm" className="cursor-pointer">
            <Link href="/settings/modules/import">
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Install a module
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function ModulesSettingsPage() {
  const { data: modules, isLoading } = useModules(null);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-48" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      </div>
    );
  }

  if (!modules || modules.length === 0) {
    return (
      <div className="space-y-6">
        <DefaultModulesCard />
        <EmptyState
          icon={FileBox}
          title="No modules installed"
          description="Download the default modules from Sciebo above, or upload your own .zip / .tar.gz."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <DefaultModulesCard />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {modules.map((m) => (
        <Card key={m.id} className="gap-0 py-0">
          <CardContent className="space-y-3 p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="truncate text-sm font-semibold">{m.name}</h3>
                  <span className="text-xs text-muted-foreground">{m.version}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <Badge variant="secondary" className="h-5 px-2 py-0 text-[9px] font-medium uppercase tracking-wide">
                    {m.category.replace("_", " ")}
                  </Badge>
                </div>
              </div>
            </div>
            {m.description && (
              <p className="line-clamp-2 text-xs text-muted-foreground">{m.description}</p>
            )}
            <Button asChild variant="outline" size="sm" className="cursor-pointer w-full">
              <Link href={`/settings/modules/${m.id}`}>Configure</Link>
            </Button>
          </CardContent>
        </Card>
      ))}
      </div>
    </div>
  );
}
