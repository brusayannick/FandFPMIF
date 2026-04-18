"use client";

import {
  Circle,
  CircleDot,
  Square,
  User,
  Cog,
  FileCode,
  Diamond,
  Plus,
  Layers,
  CircleStop,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { NodeKind } from "@/lib/schemas/graph";

interface PaletteItem {
  kind: NodeKind;
  label: string;
  icon: LucideIcon;
}

interface PaletteGroup {
  heading: string;
  items: PaletteItem[];
}

const groups: PaletteGroup[] = [
  {
    heading: "Events",
    items: [
      { kind: "startEvent", label: "Start", icon: Circle },
      { kind: "intermediateEvent", label: "Intermediate", icon: CircleDot },
      { kind: "endEvent", label: "End", icon: CircleStop },
    ],
  },
  {
    heading: "Tasks",
    items: [
      { kind: "task", label: "Task", icon: Square },
      { kind: "userTask", label: "User task", icon: User },
      { kind: "serviceTask", label: "Service task", icon: Cog },
      { kind: "scriptTask", label: "Script task", icon: FileCode },
    ],
  },
  {
    heading: "Gateways",
    items: [
      { kind: "exclusiveGateway", label: "Exclusive", icon: Diamond },
      { kind: "parallelGateway", label: "Parallel", icon: Plus },
      { kind: "inclusiveGateway", label: "Inclusive", icon: CircleDot },
    ],
  },
  {
    heading: "Subprocess",
    items: [{ kind: "subprocess", label: "Subprocess", icon: Layers }],
  },
];

export function NodePalette() {
  function onDragStart(event: React.DragEvent, kind: NodeKind) {
    event.dataTransfer.setData("application/reactflow", kind);
    event.dataTransfer.effectAllowed = "move";
  }

  return (
    <aside
      aria-label="Node palette"
      className="flex h-full w-[180px] shrink-0 flex-col border-r bg-surface"
    >
      <div className="flex h-10 items-center border-b px-3 text-[11px] font-medium uppercase tracking-wider text-text-muted">
        Node Palette
      </div>
      <div className="flex-1 overflow-y-auto">
        {groups.map((g) => (
          <section key={g.heading} className="px-2 py-2">
            <h3 className="px-1 pb-1 text-[10px] font-medium uppercase tracking-wider text-text-faint">
              {g.heading}
            </h3>
            <ul className="flex flex-col gap-1">
              {g.items.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.kind}>
                    <div
                      draggable
                      onDragStart={(e) => onDragStart(e, item.kind)}
                      className="flex cursor-grab items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-[12px] text-text-muted hover:border-border hover:bg-surface-offset hover:text-text active:cursor-grabbing"
                      title={`Drag to canvas: ${item.label}`}
                    >
                      <Icon size={14} className="shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
      <div className="border-t p-2 text-[10px] text-text-faint">
        Drag onto canvas to add.
      </div>
    </aside>
  );
}
