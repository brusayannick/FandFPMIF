import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  primaryAction?: React.ReactNode;
  secondaryAction?: React.ReactNode;
  className?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  primaryAction,
  secondaryAction,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "mx-auto flex max-w-md flex-col items-center justify-center gap-3 py-16 text-center",
        // Soft entrance: the shell fades/scales in, the icon pops a beat
        // later. One-shot, no perpetual motion; reduced-motion rule kills it.
        "animate-in fade-in-0 zoom-in-95 duration-300",
        className,
      )}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground animate-in fade-in-0 zoom-in-50 fill-mode-both delay-100 duration-300">
        <Icon className="h-5 w-5" />
      </div>
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      {description && <p className="text-sm text-muted-foreground">{description}</p>}
      {(primaryAction || secondaryAction) && (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          {primaryAction}
          {secondaryAction}
        </div>
      )}
    </div>
  );
}
