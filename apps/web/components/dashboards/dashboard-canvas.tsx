"use client";

import { useMemo } from "react";
import RGL, { WidthProvider, type Layout } from "react-grid-layout";

import { DashboardCard } from "@/components/dashboards/dashboard-card";
import {
  configDefaults,
  GRANULARITY,
  useCardCatalog,
  type CanvasSettings,
  type DashboardCard as CatalogCard,
  type DashboardItem,
  type WidgetConfigSchema,
} from "@/lib/dashboard-queries";

import "react-grid-layout/css/styles.css";

const GridLayout = WidthProvider(RGL);

/**
 * The react-grid-layout canvas. In edit mode it accepts drops from the palette
 * (`pendingCard`), and drag/resize via the card header handle. Geometry changes
 * flow back through `onItemsChange`; the parent owns the canonical item list.
 * The `settings.granularity` chooses the row height, gutter, and compaction.
 */
export function DashboardCanvas({
  items,
  logId,
  editing,
  pendingCard,
  settings,
  onItemsChange,
}: {
  items: DashboardItem[];
  logId: string | null;
  editing: boolean;
  pendingCard: CatalogCard | null;
  settings: CanvasSettings;
  onItemsChange: (items: DashboardItem[]) => void;
}) {
  const grid = GRANULARITY[settings.granularity] ?? GRANULARITY.medium;
  const cols = grid.cols;
  // The catalog carries each card's `config_schema`; a placed item only stores
  // chosen values, so we look the schema up by `(module_id, widget_id)` to
  // render its settings form. Cached by react-query (the palette fetches it).
  const { data: catalog } = useCardCatalog();
  const schemaFor = useMemo(() => {
    const map = new Map<string, WidgetConfigSchema | null>();
    for (const c of catalog ?? []) map.set(`${c.module_id}:${c.widget_id}`, c.config_schema);
    return (moduleId: string, widgetId: string) => map.get(`${moduleId}:${widgetId}`);
  }, [catalog]);

  const layout = useMemo<Layout[]>(
    () =>
      items.map((it) => ({ i: it.i, x: it.x, y: it.y, w: it.w, h: it.h, minW: 2, minH: 3 })),
    [items],
  );

  const handleLayoutChange = (next: Layout[]) => {
    if (!editing) return;
    const byId = new Map(next.map((l) => [l.i, l]));
    const merged = items.map((it) => {
      const l = byId.get(it.i);
      return l ? { ...it, x: l.x, y: l.y, w: l.w, h: l.h } : it;
    });
    // Only propagate if geometry actually changed (RGL fires on mount too).
    const changed = merged.some(
      (m, idx) =>
        m.x !== items[idx].x ||
        m.y !== items[idx].y ||
        m.w !== items[idx].w ||
        m.h !== items[idx].h,
    );
    if (changed) onItemsChange(merged);
  };

  const handleDrop = (_layout: Layout[], dropped: Layout) => {
    if (!pendingCard) return;
    const newItem: DashboardItem = {
      i:
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `card-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      module_id: pendingCard.module_id,
      widget_id: pendingCard.widget_id,
      title: pendingCard.title,
      x: dropped.x,
      y: dropped.y,
      w: pendingCard.default_w,
      h: pendingCard.default_h,
      config: configDefaults(pendingCard.config_schema),
    };
    onItemsChange([...items, newItem]);
  };

  const removeItem = (id: string) => onItemsChange(items.filter((it) => it.i !== id));

  const updateItem = (id: string, patch: { title?: string; config?: Record<string, unknown> }) =>
    onItemsChange(items.map((it) => (it.i === id ? { ...it, ...patch } : it)));

  return (
    <GridLayout
      className="min-h-full"
      layout={layout}
      cols={cols}
      rowHeight={grid.rowHeight}
      margin={grid.margin}
      isDraggable={editing}
      isResizable={editing}
      isDroppable={editing}
      draggableHandle=".dashboard-drag-handle"
      droppingItem={{
        i: "__dropping__",
        w: pendingCard?.default_w ?? 6,
        h: pendingCard?.default_h ?? 8,
      }}
      onDrop={handleDrop}
      onLayoutChange={handleLayoutChange}
      compactType={grid.compactType}
    >
      {items.map((it) => (
        <div key={it.i}>
          <DashboardCard
            item={it}
            logId={logId}
            editing={editing}
            schema={schemaFor(it.module_id, it.widget_id)}
            chrome={settings.chrome}
            onUpdate={(patch) => updateItem(it.i, patch)}
            onRemove={() => removeItem(it.i)}
          />
        </div>
      ))}
    </GridLayout>
  );
}
