"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import RGL, { WidthProvider, type Layout } from "react-grid-layout";

import { cn } from "@/lib/cn";
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

/** Do two grid rects overlap? (excludes the item against itself). */
function collides(a: DashboardItem, b: DashboardItem): boolean {
  return (
    a.i !== b.i && a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
  );
}

function firstCollision(list: DashboardItem[], it: DashboardItem): DashboardItem | null {
  for (const o of list) if (collides(o, it)) return o;
  return null;
}

/**
 * Non-compacting reflow. Places `id` at `(x, y)`, pushes *only* the cards it
 * (transitively) overlaps straight down, and leaves every other card exactly
 * where `snapshot` had it. It's recomputed from the drag-start snapshot on every
 * pointer move, so displaced cards spring back the instant the dragged card
 * leaves them — while intentional gaps survive (there's no vertical compaction,
 * unlike react-grid-layout's built-in `compactType: "vertical"`).
 */
function reflowFree(snapshot: DashboardItem[], id: string, x: number, y: number): DashboardItem[] {
  const result = snapshot.map((it) => ({ ...it }));
  const dragged = result.find((it) => it.i === id);
  if (!dragged) return result;
  dragged.x = x;
  dragged.y = y;
  // The dragged card is the fixed obstacle everyone yields to. Resolve the rest
  // in reading order, pushing each below whatever it lands on, then add it to the
  // obstacle set so later cards cascade off it too.
  const placed: DashboardItem[] = [dragged];
  const others = result
    .filter((it) => it.i !== id)
    .sort((a, b) => a.y - b.y || a.x - b.x);
  for (const it of others) {
    let guard = 0;
    let c: DashboardItem | null;
    while ((c = firstCollision(placed, it)) && guard++ < 1000) it.y = c.y + c.h;
    placed.push(it);
  }
  return result;
}

type FreeDrag = {
  id: string;
  pointerX: number;
  pointerY: number;
  startLeft: number;
  startTop: number;
  stepX: number;
  stepY: number;
  padX: number;
  padY: number;
  w: number;
  cols: number;
  snapshot: DashboardItem[];
};

/**
 * The react-grid-layout canvas. In edit mode it accepts drops from the palette
 * (`pendingCard`), and drag/resize via the card header handle. Geometry changes
 * flow back through `onItemsChange`; the parent owns the canonical item list.
 * The `settings.granularity` chooses the snap resolution (cols), row height, and
 * gutter — never auto-compaction, so cards stay exactly where you place them.
 *
 * Since no granularity compacts (`compactType: null`), drag is driven here
 * instead of by RGL: RGL won't let the layout prop move non-dragged cards
 * mid-drag, and its null-compaction never springs pushed cards back. So RGL's
 * own drag is disabled and a fully controlled layout is recomputed per pointer
 * move (see `reflowFree`); RGL still owns native resize and palette drops.
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
  const freeReflow = editing && grid.compactType === null;

  // Suppress RGL's one-time mount slide: WidthProvider first lays the cards out
  // at its 1280px default, then reflows to the measured width, and the CSS
  // transition animates that gap. Disable the transition until the reflow has
  // settled (two frames), then restore it so drag/resize stay animated.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setMounted(true));
    });
    return () => {
      cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
  }, []);
  // The catalog carries each card's `config_schema`; a placed item only stores
  // chosen values, so we look the schema up by `(module_id, widget_id)` to
  // render its settings form. Cached by react-query (the palette fetches it).
  const { data: catalog } = useCardCatalog();
  const schemaFor = useMemo(() => {
    const map = new Map<string, WidgetConfigSchema | null>();
    for (const c of catalog ?? []) map.set(`${c.module_id}:${c.widget_id}`, c.config_schema);
    return (moduleId: string, widgetId: string) => map.get(`${moduleId}:${widgetId}`);
  }, [catalog]);

  // Live free-mode drag state. `liveItems` overrides the rendered layout while a
  // drag is in flight; `draggingId` marks the card whose transition is killed so
  // it tracks the cursor instead of easing behind it.
  const [liveItems, setLiveItems] = useState<DashboardItem[] | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const dragRef = useRef<FreeDrag | null>(null);
  const liveRef = useRef<DashboardItem[] | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  // Detach in-flight drag listeners if we unmount mid-drag.
  const teardownRef = useRef<() => void>(() => {});
  useEffect(() => () => teardownRef.current(), []);

  // Cards render from the committed `items` (stable content) and are positioned
  // by the `layout` prop, which carries live positions during a free drag. That
  // split keeps widget bodies from re-rendering on every pointer move.
  const displayItems = liveItems ?? items;
  const layout = useMemo<Layout[]>(
    () =>
      displayItems.map((it) => ({ i: it.i, x: it.x, y: it.y, w: it.w, h: it.h, minW: 2, minH: 3 })),
    [displayItems],
  );

  // Stable refs/handlers so memoized cards don't re-render while dragging.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const onItemsChangeRef = useRef(onItemsChange);
  onItemsChangeRef.current = onItemsChange;
  const updateItem = useCallback(
    (id: string, patch: { title?: string; config?: Record<string, unknown> }) =>
      onItemsChangeRef.current(
        itemsRef.current.map((it) => (it.i === id ? { ...it, ...patch } : it)),
      ),
    [],
  );
  const removeItem = useCallback(
    (id: string) => onItemsChangeRef.current(itemsRef.current.filter((it) => it.i !== id)),
    [],
  );
  const cardHandlers = useMemo(() => {
    const m = new Map<
      string,
      { onUpdate: (p: { title?: string; config?: Record<string, unknown> }) => void; onRemove: () => void }
    >();
    for (const it of items)
      m.set(it.i, { onUpdate: (p) => updateItem(it.i, p), onRemove: () => removeItem(it.i) });
    return m;
  }, [items, updateItem, removeItem]);

  const handleLayoutChange = (next: Layout[]) => {
    // RGL fires this on mount, on resize, and on its own (non-free) drags. While
    // a free drag is in flight the layout prop is ours, so ignore the echo.
    if (!editing || dragRef.current) return;
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

  // Free-mode pointer drag. Bubble phase (not capture) so the header's control
  // buttons, which `stopPropagation`, never start a drag.
  const onPointerDown = (e: React.PointerEvent) => {
    if (!freeReflow || dragRef.current) return;
    const target = e.target as HTMLElement;
    if (!target.closest(".dashboard-drag-handle")) return;
    const cardEl = target.closest("[data-grid-id]") as HTMLElement | null;
    const id = cardEl?.dataset.gridId;
    if (!id) return;
    const it = itemsRef.current.find((i) => i.i === id);
    if (!it) return;
    const gridEl = wrapRef.current?.querySelector(".react-grid-layout") as HTMLElement | null;
    const width = gridEl?.clientWidth ?? wrapRef.current?.clientWidth ?? 0;
    if (!width) return;

    // RGL geometry: containerPadding defaults to margin, so both pad and gap are
    // `margin`. Mirror calcGridColWidth/calcXY so snapping matches RGL exactly.
    const [marginX, marginY] = grid.margin;
    const colW = (width - marginX * (cols - 1) - marginX * 2) / cols;
    const drag: FreeDrag = {
      id,
      pointerX: e.clientX,
      pointerY: e.clientY,
      startLeft: marginX + it.x * (colW + marginX),
      startTop: marginY + it.y * (grid.rowHeight + marginY),
      stepX: colW + marginX,
      stepY: grid.rowHeight + marginY,
      padX: marginX,
      padY: marginY,
      w: it.w,
      cols,
      snapshot: itemsRef.current,
    };
    dragRef.current = drag;
    liveRef.current = itemsRef.current;
    setDraggingId(id);
    setLiveItems(itemsRef.current);
    e.preventDefault();

    const move = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const left = d.startLeft + (ev.clientX - d.pointerX);
      const top = d.startTop + (ev.clientY - d.pointerY);
      const x = Math.max(0, Math.min(d.cols - d.w, Math.round((left - d.padX) / d.stepX)));
      const y = Math.max(0, Math.round((top - d.padY) / d.stepY));
      const nextLayout = reflowFree(d.snapshot, d.id, x, y);
      liveRef.current = nextLayout;
      setLiveItems(nextLayout);
    };
    const end = (commit: boolean) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      teardownRef.current = () => {};
      const final = liveRef.current;
      dragRef.current = null;
      liveRef.current = null;
      setDraggingId(null);
      setLiveItems(null);
      if (commit && final) {
        const changed = final.some((m) => {
          const o = itemsRef.current.find((i) => i.i === m.i);
          return !o || o.x !== m.x || o.y !== m.y;
        });
        if (changed) onItemsChangeRef.current(final);
      }
    };
    const up = () => end(true);
    const cancel = () => end(false);
    teardownRef.current = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
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

  return (
    <div ref={wrapRef} className="min-h-full" onPointerDown={freeReflow ? onPointerDown : undefined}>
      <GridLayout
        className={cn("min-h-full", !mounted && "rgl-mounting")}
        layout={layout}
        cols={cols}
        rowHeight={grid.rowHeight}
        margin={grid.margin}
        isDraggable={editing && grid.compactType !== null}
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
        {items.map((it) => {
          const h = cardHandlers.get(it.i);
          return (
            <div
              key={it.i}
              data-grid-id={it.i}
              className={cn(draggingId === it.i && "rgl-free-dragging")}
            >
              <DashboardCard
                item={it}
                logId={logId}
                editing={editing}
                schema={schemaFor(it.module_id, it.widget_id)}
                chrome={settings.chrome}
                onUpdate={h?.onUpdate ?? (() => {})}
                onRemove={h?.onRemove ?? (() => {})}
              />
            </div>
          );
        })}
      </GridLayout>
    </div>
  );
}
