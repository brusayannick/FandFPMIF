"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";

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
        "group relative flex h-full flex-col transition-all",
        isAvailable && "cursor-pointer hover:-translate-y-0.5 hover:shadow-md",
        isDegraded && "cursor-pointer hover:shadow-md",
        (isUnavailable || isDisabled) && "cursor-not-allowed opacity-60",
      )}
      aria-disabled={isUnavailable || isDisabled}
    >
      <CardContent className="flex h-full flex-col gap-3 p-4">
        {/* Header: Name, version, author */}
        <div className="flex items-start justify-between gap-2 min-w-0">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-semibold leading-tight">{module.name}</h3>
            <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
              {module.version && <span className="shrink-0">{module.version}</span>}
              {module.author && module.version && <span className="shrink-0 text-muted-foreground/50">·</span>}
              {module.author && <span className="truncate">by {module.author}</span>}
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0 cursor-pointer opacity-0 transition-opacity group-hover:opacity-100"
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

        {/* Category & Status */}
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge
            variant="secondary"
            className="h-5 px-2 py-0 text-[9px] font-medium uppercase tracking-wide"
          >
            {module.category.replace(/_/g, " ")}
          </Badge>
          {isDisabled && (
            <Badge className="h-5 border-0 bg-muted px-2 py-0 text-[9px] font-medium text-muted-foreground">
              Disabled
            </Badge>
          )}
          {!isDisabled && isDegraded && (
            <Badge className="h-5 border-0 bg-amber-500/15 px-2 py-0 text-[9px] font-medium text-amber-700 dark:text-amber-400">
              Limited
            </Badge>
          )}
          {!isDisabled && isUnavailable && (
            <Badge className="h-5 border-0 bg-destructive/10 px-2 py-0 text-[9px] font-medium text-destructive">
              Unavailable
            </Badge>
          )}
        </div>

        {/* Description */}
        {module.description && (
          <p className="line-clamp-2 flex-1 text-xs leading-snug text-muted-foreground">
            {module.description}
          </p>
        )}
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
