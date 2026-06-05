"use client";

import { useMemo, useState } from "react";
import { Boxes, ChevronDown, Plus, Search } from "lucide-react";

import { cn } from "@/lib/cn";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cardIcon } from "@/components/dashboards/card-icon";
import { useCardCatalog, type DashboardCard } from "@/lib/dashboard-queries";

/**
 * Left-rail palette of every card exposed by the user's installed modules,
 * grouped into a clearly delineated, collapsible section per module. Cards are
 * HTML5-draggable onto the grid (the canvas reads `setPendingCard` on drop) and
 * also click-to-add for keyboard/no-drag use.
 */
export function CardPalette({
  onPickCard,
  onDragCard,
}: {
  onPickCard: (card: DashboardCard) => void;
  onDragCard: (card: DashboardCard | null) => void;
}) {
  const { data: cards, isLoading } = useCardCatalog();
  const [query, setQuery] = useState("");
  // Module ids the user has explicitly collapsed. A search overrides this so
  // matches are never hidden behind a collapsed header.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = (cards ?? []).filter(
      (c) =>
        !q ||
        c.title.toLowerCase().includes(q) ||
        c.module_name.toLowerCase().includes(q) ||
        (c.description ?? "").toLowerCase().includes(q),
    );
    const byModule = new Map<string, { id: string; name: string; cards: DashboardCard[] }>();
    for (const c of filtered) {
      const g = byModule.get(c.module_id) ?? { id: c.module_id, name: c.module_name, cards: [] };
      g.cards.push(c);
      byModule.set(c.module_id, g);
    }
    return [...byModule.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [cards, query]);

  const searching = query.trim().length > 0;
  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="flex h-full w-64 shrink-0 flex-col border-r border-border bg-muted/20">
      <div className="border-b border-border p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Cards
        </p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Drag onto the board, or click to add.
        </p>
        <div className="relative mt-2">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search cards…"
            className="h-8 pl-7 text-xs"
          />
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-3 p-3">
          {isLoading && <p className="text-xs text-muted-foreground">Loading cards…</p>}
          {!isLoading && groups.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No cards match. Modules expose cards via their manifest.
            </p>
          )}
          {groups.map((group) => {
            const open = searching || !collapsed.has(group.id);
            return (
              <section
                key={group.id}
                className="overflow-hidden rounded-lg border border-border bg-card/40"
              >
                <button
                  type="button"
                  onClick={() => toggle(group.id)}
                  aria-expanded={open}
                  className="flex w-full items-center gap-2 bg-muted/40 px-2.5 py-2 text-left hover:bg-muted/60"
                >
                  <Boxes className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-xs font-semibold tracking-tight">
                    {group.name}
                  </span>
                  <span className="shrink-0 rounded-full bg-background/80 px-1.5 text-[10px] font-medium tabular-nums text-muted-foreground">
                    {group.cards.length}
                  </span>
                  <ChevronDown
                    className={cn(
                      "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
                      !open && "-rotate-90",
                    )}
                  />
                </button>

                {open && (
                  <div className="space-y-1 p-1.5">
                    {group.cards.map((card) => {
                      const Icon = cardIcon(card.icon);
                      return (
                        <button
                          key={`${card.module_id}:${card.widget_id}`}
                          type="button"
                          // RGL droppable: any element with draggable=true
                          // dropped over the grid fires its onDrop; we stash the
                          // card so the canvas knows which one landed.
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.effectAllowed = "copy";
                            e.dataTransfer.setData(
                              "text/plain",
                              `${card.module_id}:${card.widget_id}`,
                            );
                            onDragCard(card);
                          }}
                          onDragEnd={() => onDragCard(null)}
                          onClick={() => onPickCard(card)}
                          className={cn(
                            "group flex w-full items-start gap-2 rounded-md border border-transparent px-2 py-1.5 text-left",
                            "cursor-grab hover:border-border hover:bg-card active:cursor-grabbing",
                          )}
                        >
                          <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-medium">
                              {card.title}
                            </span>
                            {card.description && (
                              <span className="mt-0.5 line-clamp-2 block text-[11px] leading-snug text-muted-foreground">
                                {card.description}
                              </span>
                            )}
                          </span>
                          <Plus className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/0 group-hover:text-muted-foreground" />
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
