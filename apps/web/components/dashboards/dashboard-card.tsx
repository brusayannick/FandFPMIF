"use client";

import { memo } from "react";
import { GripVertical, Settings2, X } from "lucide-react";

import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useWidget } from "@/lib/module-widgets";
import { CardConfigForm } from "@/components/dashboards/card-config-form";
import { FlowCardBody, GenericVizBody, VizSettings } from "@/components/dashboards/generic-viz-card";
import {
  DEFAULT_CARD_CHROME,
  type CardChrome,
  type DashboardItem,
  type WidgetConfigSchema,
} from "@/lib/dashboard-queries";

/** Patch the card settings emit back to the canvas. Covers both kinds: a widget
 * card only ever sets `title`/`config`; a viz card also sets `viz_id`/`mapping`. */
export interface CardPatch {
  title?: string | null;
  config?: Record<string, unknown>;
  viz_id?: string | null;
  mapping?: Record<string, unknown>;
}

/**
 * One placed card on the dashboard grid. Dispatches on `item.kind`:
 *   - "widget" (default/legacy): a module-authored bundle via `useWidget`.
 *   - "viz": a generic visualization bound to a module dataset.
 * The header chrome (drag handle, settings popover, remove) is shared; only the
 * body and the settings form differ.
 */
export const DashboardCard = memo(function DashboardCard({
  item,
  logId,
  editing,
  schema,
  chrome = DEFAULT_CARD_CHROME,
  onUpdate,
  onRemove,
}: {
  item: DashboardItem;
  logId: string | null;
  editing: boolean;
  schema: WidgetConfigSchema | null | undefined;
  chrome?: CardChrome;
  onUpdate: (patch: CardPatch) => void;
  onRemove: () => void;
}) {
  const isViz = item.kind === "viz";
  const isFlow = item.kind === "flow";
  const title =
    item.title || (isViz ? "Visualization" : isFlow ? "Flow visualization" : item.widget_id) || "Card";
  // Don't let RGL begin a drag when the user interacts with header controls.
  const stopDrag = (e: React.MouseEvent | React.PointerEvent) => e.stopPropagation();

  return (
    <div
      className={cn(
        "dashboard-card-root flex h-full flex-col overflow-hidden rounded-lg bg-card shadow-sm",
        "transition-[box-shadow,transform,outline-color] duration-150 ease-out",
        chrome.border && "border border-border",
        // Edit mode: cards read as grabbable objects — a faint ring at rest
        // that firms up (with a soft lift) under the pointer, n8n-node style.
        editing && "ring-1 ring-border/60 hover:shadow-md hover:ring-border",
      )}
    >
      <div
        className={cn(
          "flex shrink-0 items-center gap-1.5 border-b border-border/60 px-3 py-2",
          editing && "dashboard-drag-handle",
        )}
      >
        {editing && (
          <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60 animate-in fade-in-0 slide-in-from-left-2 duration-150" />
        )}
        <span className="min-w-0 flex-1 truncate text-xs font-medium tracking-tight">{title}</span>
        {editing && (
          <span className="flex shrink-0 items-center gap-1.5 animate-in fade-in-0 slide-in-from-right-2 duration-150">
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Configure ${title}`}
                  className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
                  onMouseDown={stopDrag}
                  onPointerDown={stopDrag}
                >
                  <Settings2 className="h-3.5 w-3.5" />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                className="w-72"
                onMouseDown={stopDrag}
                onPointerDown={stopDrag}
              >
                <PopoverHeader>
                  <PopoverTitle>Card settings</PopoverTitle>
                </PopoverHeader>
                {isFlow ? (
                  <p className="text-[11px] text-muted-foreground">
                    This card mirrors a Builder flow node. Edit its visualization in the Builder.
                  </p>
                ) : isViz ? (
                  <VizSettings item={item} logId={logId} onChange={onUpdate} />
                ) : (
                  <CardConfigForm item={item} schema={schema} onChange={onUpdate} />
                )}
              </PopoverContent>
            </Popover>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove ${title}`}
              className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
              onMouseDown={stopDrag}
              onPointerDown={stopDrag}
              onClick={onRemove}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </span>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3 animate-in fade-in-0 duration-300">
        {isFlow ? (
          <FlowCardBody item={item} />
        ) : isViz ? (
          <GenericVizBody item={item} logId={logId} />
        ) : (
          <WidgetBody item={item} logId={logId} />
        )}
      </div>
    </div>
  );
});

/** Module-authored widget body (the original card path). Only rendered for
 * `kind:"widget"` items, so `module_id`/`widget_id` are always present. */
function WidgetBody({ item, logId }: { item: DashboardItem; logId: string | null }) {
  const Widget = useWidget(item.module_id ?? "", item.widget_id ?? "");
  if (!logId) {
    return (
      <div className="flex h-full items-center justify-center text-center text-xs text-muted-foreground">
        Select an event log to populate this card.
      </div>
    );
  }
  return <Widget logId={logId} moduleId={item.module_id ?? ""} config={item.config} />;
}
