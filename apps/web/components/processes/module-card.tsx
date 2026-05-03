"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, MoreHorizontal } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import type { ModuleSummary } from "@/lib/api-types";

interface ModuleCardProps {
  module: ModuleSummary;
  logId: string;
}

export function ModuleCard({ module, logId }: ModuleCardProps) {
  const router = useRouter();
  const status = module.availability?.status ?? "available";
  const reasons = module.availability?.reasons ?? [];

  const isDisabled = module.enabled === false;
  const isAvailable = !isDisabled && status === "available";
  const isDegraded = !isDisabled && status === "degraded";
  const isUnavailable = !isDisabled && status === "unavailable";

  const tooltipReasons = isDisabled
    ? ["Disabled in Settings → Modules. Enable it to open the module page."]
    : reasons;

  const onClick = () => {
    if (!isAvailable && !isDegraded) return;
    router.push(`/processes/${logId}/modules/${module.id}`);
  };

  const card = (
    <Card
      role="link"
      tabIndex={isUnavailable || isDisabled ? -1 : 0}
      onClick={onClick}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !isUnavailable && !isDisabled) {
          e.preventDefault();
          onClick();
        }
      }}
      className={cn(
        "group relative flex h-full flex-col gap-2 transition-all",
        isAvailable && "cursor-pointer hover:-translate-y-0.5 hover:shadow-md",
        isDegraded && "cursor-pointer hover:shadow-md",
        (isUnavailable || isDisabled) && "cursor-not-allowed opacity-60",
      )}
      aria-disabled={isUnavailable || isDisabled}
    >
      <CardContent className="flex h-full flex-col gap-2 p-[var(--card-padding)]">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-sm font-semibold">{module.name}</h3>
              <span className="text-xs text-muted-foreground">{module.version}</span>
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" className="border-0 bg-muted text-[10px] uppercase tracking-wide text-muted-foreground">
                {module.category.replace("_", " ")}
              </Badge>
              {isDisabled && (
                <Badge className="border-0 bg-muted text-[10px] text-muted-foreground">
                  Disabled
                </Badge>
              )}
              {!isDisabled && isDegraded && (
                <Badge className="border-0 bg-chart-4/20 text-[10px] text-foreground">
                  Limited
                </Badge>
              )}
              {!isDisabled && isUnavailable && (
                <Badge className="border-0 bg-muted text-[10px] text-muted-foreground">
                  Requirements not met
                </Badge>
              )}
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 cursor-pointer opacity-0 transition-opacity group-hover:opacity-100"
                aria-label="Module actions"
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuItem asChild className="cursor-pointer">
                <Link href={`/settings/modules/${module.id}`}>About this module</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild className="cursor-pointer">
                <Link href={`/settings/modules/${module.id}`}>Configure</Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  window.open(`/processes/${logId}/modules/${module.id}`, "_blank")
                }
                className="cursor-pointer"
                disabled={isUnavailable || isDisabled}
              >
                Open in new tab
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {module.description && (
          <p className="line-clamp-3 text-xs text-muted-foreground">{module.description}</p>
        )}
        <div className="mt-auto flex items-center justify-between pt-1">
          <span className="text-xs text-muted-foreground">
            {module.provides.length} capabilit{module.provides.length === 1 ? "y" : "ies"}
          </span>
          {(isAvailable || isDegraded) && (
            <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          )}
        </div>
      </CardContent>
    </Card>
  );

  if (tooltipReasons.length === 0) return card;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{card}</TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-sm">
        <ul className="list-disc pl-4 text-xs">
          {tooltipReasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  );
}
