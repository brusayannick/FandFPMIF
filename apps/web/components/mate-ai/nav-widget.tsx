"use client";

import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Compass,
  ExternalLink,
  Lock,
  MoreVertical,
  RotateCcw,
  SlidersHorizontal,
} from "lucide-react";

import { cn } from "@/lib/cn";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface NavTarget {
  id: string;
  label: string;
  kind: string;
  href: string;
  requires_log: boolean;
  available: boolean;
}

export interface ActionTarget {
  setting: string;
  value: string | boolean;
  label: string;
  target: string;
}

// Container for a chip row. Not clickable itself – the inner button is – so the
// 3-dots menu can live as a sibling (a button inside a button is invalid HTML).
const chipRow = cn(
  "group flex w-full items-center gap-1 rounded-lg border border-sidebar-border bg-sidebar-accent/40 pr-1 transition-colors",
  "hover:border-sidebar-primary/40 hover:bg-sidebar-accent/70",
);

const chipButton = "flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 px-3 py-2 text-left";

const chipIcon =
  "flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-sidebar text-sidebar-primary";

/**
 * Renders the navigation + settings suggestions returned by `/api/v1/ai/route`
 * as clickable chips below an assistant message. Both are purely additive.
 *
 * Navigation chips: clicking navigates; the chip then flips to "Go back" to
 * return to the previous page. A 3-dots menu opens the destination in a new tab.
 * Settings chips: clicking applies the change; the chip then flips to "Undo" to
 * revert it (the parent supplies the revert closure via `onAction`).
 */
export function NavWidget({
  targets = [],
  actions = [],
  currentPath,
  onNavigate,
  onAction,
}: {
  targets?: NavTarget[];
  actions?: ActionTarget[];
  /** The route the user is on when a chip is clicked – captured as the "back" target. */
  currentPath?: string;
  onNavigate: (target: NavTarget) => void;
  /** Applies the setting and returns a closure that reverts it (or void). */
  onAction?: (action: ActionTarget) => (() => void) | void;
}) {
  // nav target id -> href to return to (present ⇒ chip is in "Go back" mode)
  const [backHrefs, setBackHrefs] = useState<Map<string, string>>(new Map());
  // setting id -> revert closure (present ⇒ chip is applied / in "Undo" mode)
  const [undos, setUndos] = useState<Map<string, () => void>>(new Map());

  if (targets.length === 0 && actions.length === 0) return null;

  const clickNav = (t: NavTarget) => {
    const back = backHrefs.get(t.id);
    if (back !== undefined) {
      // "Go back" – return to where we were and reset the chip.
      onNavigate({ ...t, href: back });
      setBackHrefs((prev) => {
        const m = new Map(prev);
        m.delete(t.id);
        return m;
      });
      return;
    }
    const from = currentPath ?? "";
    onNavigate(t);
    if (from && from !== t.href) {
      setBackHrefs((prev) => new Map(prev).set(t.id, from));
    }
  };

  const clickAction = (a: ActionTarget) => {
    const undo = undos.get(a.setting);
    if (undo) {
      undo();
      setUndos((prev) => {
        const m = new Map(prev);
        m.delete(a.setting);
        return m;
      });
      return;
    }
    const revert = onAction?.(a);
    setUndos((prev) => new Map(prev).set(a.setting, typeof revert === "function" ? revert : () => {}));
  };

  return (
    <div className="mt-2 space-y-2.5">
      {targets.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 px-0.5 text-[10px] font-medium uppercase tracking-wide text-sidebar-foreground/45">
            <Compass className="h-3 w-3" />
            Jump to
          </div>
          {targets.map((t) => {
            const isBack = backHrefs.has(t.id);
            const locked = t.requires_log && !t.available;
            return (
              <div key={t.id} className={chipRow}>
                <button type="button" onClick={() => clickNav(t)} className={chipButton}>
                  <div className={chipIcon}>
                    {isBack ? (
                      <ArrowLeft className="h-3 w-3" />
                    ) : locked ? (
                      <Lock className="h-3 w-3" />
                    ) : (
                      <ArrowRight className="h-3 w-3" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium text-sidebar-foreground">
                      {isBack ? "Go back" : t.label}
                    </div>
                    {locked && !isBack && (
                      <div className="mt-0.5 text-[10px] text-sidebar-foreground/50">
                        Open a process to view this module&apos;s panel – opens settings for now.
                      </div>
                    )}
                  </div>
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label="More options"
                      className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-sidebar-foreground/50 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
                    >
                      <MoreVertical className="h-3.5 w-3.5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-[10rem]">
                    <DropdownMenuItem
                      onClick={() => window.open(t.href, "_blank", "noopener,noreferrer")}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Open in new tab
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            );
          })}
        </div>
      )}

      {actions.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 px-0.5 text-[10px] font-medium uppercase tracking-wide text-sidebar-foreground/45">
            <SlidersHorizontal className="h-3 w-3" />
            Apply setting
          </div>
          {actions.map((a) => {
            const applied = undos.has(a.setting);
            return (
              <div key={a.setting} className={chipRow}>
                <button type="button" onClick={() => clickAction(a)} className={chipButton}>
                  <div className={chipIcon}>
                    {applied ? (
                      <RotateCcw className="h-3 w-3" />
                    ) : (
                      <SlidersHorizontal className="h-3 w-3" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1 truncate text-xs font-medium text-sidebar-foreground">
                    {applied ? `Undo – ${a.label.toLowerCase()}` : a.label}
                  </div>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
