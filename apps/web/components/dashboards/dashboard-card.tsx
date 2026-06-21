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
import { DEFAULT_CARD_CHROME, type CardChrome, type DashboardItem, type WidgetConfigSchema } from "@/lib/dashboard-queries";

/**
 * One placed card on the dashboard grid. Resolves the module's widget bundle
 * via `useWidget(module_id, widget_id)` and renders it against the bound log.
 * In edit mode the header doubles as the react-grid-layout drag handle
 * (`.dashboard-drag-handle`) and exposes per-card settings (title + the
 * widget's `config_schema`) and a remove button.
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
  /** Board-wide appearance toggles (border / header / shadow). */
  chrome?: CardChrome;
  onUpdate: (patch: { title?: string; config?: Record<string, unknown> }) => void;
  onRemove: () => void;
}) {
  const Widget = useWidget(item.module_id, item.widget_id);
  const title = item.title || item.widget_id;
  // Don't let RGL begin a drag when the user interacts with header controls.
  const stopDrag = (e: React.MouseEvent | React.PointerEvent) => e.stopPropagation();

  return (
    <div
      className={cn(
        "flex h-full flex-col overflow-hidden rounded-lg bg-card shadow-sm",
        chrome.border && "border border-border",
      )}
    >
      <div
        className={cn(
          "flex shrink-0 items-center gap-1.5 border-b border-border/60 px-3 py-2",
          editing && "dashboard-drag-handle cursor-move",
        )}
      >
        {editing && (
          <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
        )}
        <span className="min-w-0 flex-1 truncate text-xs font-medium tracking-tight">
          {title}
        </span>
        {editing && (
          <>
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
                <CardConfigForm item={item} schema={schema} onChange={onUpdate} />
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
          </>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {logId ? (
          <Widget logId={logId} moduleId={item.module_id} config={item.config} />
        ) : (
          <div className="flex h-full items-center justify-center text-center text-xs text-muted-foreground">
            Select an event log to populate this card.
          </div>
        )}
      </div>
    </div>
  );
});
