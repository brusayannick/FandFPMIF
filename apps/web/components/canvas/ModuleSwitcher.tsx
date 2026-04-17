"use client";

import { Blocks, Check, ChevronDown, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { listModules } from "@/components/modules/registry";
import { useUIStore } from "@/stores/ui.store";

export function ModuleSwitcher() {
  const activeModuleId = useUIStore((s) => s.activeModuleId);
  const setActiveModuleId = useUIStore((s) => s.setActiveModuleId);
  const setTab = useUIStore((s) => s.setActivePanelTab);
  const modules = listModules();
  const active = modules.find((m) => m.moduleId === activeModuleId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1">
          <Blocks size={14} />
          <span className="max-w-[120px] truncate">
            {active ? active.displayName : "Module"}
          </span>
          <ChevronDown size={12} className="opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-[10px] font-medium uppercase tracking-wider text-text-faint">
          Active module
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {modules.map((m) => {
          const Icon = m.icon;
          const checked = m.moduleId === activeModuleId;
          return (
            <DropdownMenuItem
              key={m.moduleId}
              onSelect={() => {
                setActiveModuleId(m.moduleId);
                setTab("analysis");
              }}
              className="gap-2"
            >
              <Icon size={14} className="shrink-0 text-text-muted" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">{m.displayName}</div>
                {m.description && (
                  <div className="truncate text-[11px] text-text-muted">
                    {m.description}
                  </div>
                )}
              </div>
              {checked && <Check size={14} className="text-primary" />}
            </DropdownMenuItem>
          );
        })}
        {active && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => setActiveModuleId(null)}
              className="gap-2 text-text-muted"
            >
              <X size={14} /> Deactivate
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
