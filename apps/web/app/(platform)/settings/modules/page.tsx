"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { FileBox } from "lucide-react";
import { useModules } from "@/lib/queries";

export default function ModulesSettingsPage() {
  const { data: modules, isLoading } = useModules(null);

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-32" />
        ))}
      </div>
    );
  }

  if (!modules || modules.length === 0) {
    return (
      <EmptyState
        icon={FileBox}
        title="No modules installed"
        description="Drop a module folder under modules/ on disk to make it available here."
      />
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {modules.map((m) => (
        <Card key={m.id}>
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
  );
}
