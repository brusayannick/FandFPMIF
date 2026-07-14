"use client";

// Generic canvas toolbar controls that live inside the CanvasShell top-right
// control cluster (`toolbarSlot`). Extracted from the discovery DFG controls so
// EVERY React-Flow canvas can render the same cluster – a settings popover and
// a reset-layout button – on top of the shell's built-in fit / zoom / fullscreen
// buttons. Exposed to module bundles as a runtime external
// (`runtime-externals.json` + `module-runtime.ts`), so keep the surface small
// and depend only on other runtime-external `@/` paths.

import { useState, type ReactNode } from "react";
import { RotateCcw, SlidersHorizontal } from "lucide-react";
import { Popover as PopoverPrimitive } from "radix-ui";

import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * Ghost icon-button + popover matching the canvas-shell toolbar. Renders
 * `children` as the popover body (the canvas-specific render settings). The
 * trigger is the standard "sliders" settings affordance so the control reads
 * identically across every canvas.
 */
export function CanvasSettingsPopover({
  children,
  label = "Graph settings",
  tourId,
  contentClassName,
}: {
  children: ReactNode;
  /** aria-label + title for the trigger button. */
  label?: string;
  /** Optional `data-tour` id on the trigger (used by the product tour). */
  tourId?: string;
  /** Extra classes for the popover content (width overrides etc.). */
  contentClassName?: string;
}) {
  return (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 cursor-pointer"
          aria-label={label}
          title={label}
          data-tour={tourId}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
        </Button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side="left"
          align="start"
          sideOffset={10}
          className={cn(
            "z-50 w-80 rounded-lg border bg-popover p-4 text-popover-foreground shadow-md outline-none",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
            contentClassName,
          )}
        >
          {children}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

/**
 * Ghost icon-button that discards dragged node positions and re-applies the
 * auto layout, behind a confirm dialog. The dialog copy is overridable so a
 * canvas can name what gets reset; the default matches the DFG wording.
 */
export function CanvasResetButton({
  onReset,
  label = "Reset layout",
  title = "Reset layout?",
  description = "All dragged node positions for this view will be discarded and the auto-layout will be reapplied. This cannot be undone.",
  confirmLabel = "Reset",
}: {
  onReset: () => void;
  /** aria-label + title for the trigger button. */
  label?: string;
  title?: string;
  description?: string;
  confirmLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 cursor-pointer"
        aria-label={label}
        title={label}
        onClick={() => setOpen(true)}
      >
        <RotateCcw className="h-3.5 w-3.5" />
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription>{description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                onReset();
                setOpen(false);
              }}
            >
              {confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
