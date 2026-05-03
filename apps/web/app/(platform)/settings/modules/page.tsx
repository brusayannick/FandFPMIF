"use client";

import Link from "next/link";
import { FileBox, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { useModules } from "@/lib/queries";

export default function ModulesSettingsPage() {
  const { data: modules, isLoading } = useModules(null);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <Button asChild className="cursor-pointer gap-2">
          <Link href="/settings/modules/import">
            <Plus className="h-4 w-4" />
            Import module
          </Link>
        </Button>
      </div>

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      ) : !modules || modules.length === 0 ? (
        <EmptyState
          icon={FileBox}
          title="No modules installed"
          description="v1 ships empty. Drop one in via the import wizard, or place a folder under modules/ on disk."
          primaryAction={
            <Button asChild className="cursor-pointer gap-2">
              <Link href="/settings/modules/import">
                <Plus className="h-4 w-4" />
                Import module
              </Link>
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {modules.map((m) => (
            <Card key={m.id}>
              <CardContent className="space-y-2 p-[var(--card-padding)]">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate text-sm font-semibold">{m.name}</h3>
                      <span className="text-xs text-muted-foreground">{m.version}</span>
                    </div>
                    <Badge variant="outline" className="mt-1 border-0 bg-muted text-[10px] uppercase tracking-wide text-muted-foreground">
                      {m.category.replace("_", " ")}
                    </Badge>
                  </div>
                </div>
                {m.description && (
                  <p className="line-clamp-2 text-xs text-muted-foreground">{m.description}</p>
                )}
                <div className="pt-2">
                  <Button asChild variant="outline" size="sm" className="cursor-pointer">
                    <Link href={`/settings/modules/${m.id}`}>Configure</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
