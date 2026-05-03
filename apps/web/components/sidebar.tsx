"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { Cog, FolderKanban, Monitor, Moon, PanelLeftClose, Pickaxe, Sun } from "lucide-react";

import { cn } from "@/lib/cn";
import { useUi } from "@/lib/stores/ui";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  match: (pathname: string) => boolean;
}

const NAV: NavItem[] = [
  {
    href: "/processes",
    label: "Processes",
    icon: FolderKanban,
    match: (p) => p === "/" || p.startsWith("/processes"),
  },
  {
    href: "/settings",
    label: "Settings",
    icon: Cog,
    match: (p) => p.startsWith("/settings"),
  },
];

export function Sidebar() {
  const collapsed = useUi((s) => s.sidebarCollapsed);
  const toggle = useUi((s) => s.toggleSidebar);
  const density = useUi((s) => s.density);
  const setDensity = useUi((s) => s.setDensity);
  const pathname = usePathname();

  return (
    <aside
      className={cn(
        "flex h-screen flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-150 ease-out",
        collapsed ? "w-14" : "w-56",
      )}
      aria-label="Primary navigation"
    >
      <div className="flex items-center gap-2 px-3 py-3.5">
        <div
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground"
          aria-hidden
        >
          <Pickaxe className="h-4 w-4" />
        </div>
        {!collapsed && (
          <span className="truncate text-sm font-semibold tracking-tight">ATLAS Hub</span>
        )}
        <button
          type="button"
          onClick={toggle}
          className="ml-auto cursor-pointer rounded-md p-1.5 text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <PanelLeftClose
            className={cn("h-4 w-4 transition-transform", collapsed && "rotate-180")}
          />
        </button>
      </div>

      <nav className="flex-1 px-2 pt-1">
        <ul className="space-y-0.5">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = item.match(pathname);
            const link = (
              <Link
                href={item.href}
                className={cn(
                  "flex h-9 items-center gap-3 rounded-md px-3 text-sm transition-colors cursor-pointer",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {!collapsed && <span>{item.label}</span>}
              </Link>
            );
            return (
              <li key={item.href}>
                {collapsed ? (
                  <Tooltip>
                    <TooltipTrigger asChild>{link}</TooltipTrigger>
                    <TooltipContent side="right">{item.label}</TooltipContent>
                  </Tooltip>
                ) : (
                  link
                )}
              </li>
            );
          })}
        </ul>
      </nav>

      <div
        className={cn(
          "flex items-center gap-2 border-t border-sidebar-border px-3 py-2",
          collapsed && "flex-col gap-1 px-1",
        )}
      >
        <ThemeToggle collapsed={collapsed} />
        {!collapsed && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto h-8 cursor-pointer text-xs text-sidebar-foreground/60"
            onClick={() => setDensity(density === "comfortable" ? "compact" : "comfortable")}
            aria-label="Toggle density"
          >
            {density === "comfortable" ? "Compact" : "Comfy"}
          </Button>
        )}
      </div>
      {!collapsed && (
        <div className="border-t border-sidebar-border px-4 py-2 text-[10px] uppercase tracking-wide text-sidebar-foreground/40">
          v0.1.0
        </div>
      )}
    </aside>
  );
}

function ThemeToggle({ collapsed }: { collapsed: boolean }) {
  const { theme, setTheme } = useTheme();
  const Icon = theme === "dark" ? Moon : theme === "light" ? Sun : Monitor;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Theme"
          className="h-8 w-8 cursor-pointer text-sidebar-foreground/70"
        >
          <Icon className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side={collapsed ? "right" : "top"} align="start">
        <DropdownMenuItem onSelect={() => setTheme("light")} className="cursor-pointer">
          <Sun className="mr-2 h-4 w-4" /> Light
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setTheme("dark")} className="cursor-pointer">
          <Moon className="mr-2 h-4 w-4" /> Dark
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setTheme("system")} className="cursor-pointer">
          <Monitor className="mr-2 h-4 w-4" /> System
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
