"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Workflow,
  Blocks,
  Settings,
  ChevronsLeft,
  ChevronsRight,
  CircleUser,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/stores/ui.store";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

const navItems: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Processes", href: "/processes", icon: Workflow },
  { label: "Modules", href: "/modules", icon: Blocks },
  { label: "Settings", href: "/settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggle = useUIStore((s) => s.toggleSidebar);

  return (
    <aside
      className={cn(
        "flex h-screen flex-col border-r bg-surface transition-[width] duration-200",
        collapsed ? "w-14" : "w-60",
      )}
      aria-label="Primary"
    >
      <div
        className={cn(
          "flex h-14 items-center border-b px-3",
          collapsed ? "justify-center" : "justify-between",
        )}
      >
        {!collapsed && (
          <Link
            href="/dashboard"
            className="flex items-center gap-2 font-semibold tracking-tight"
          >
            <LogoMark />
            <span className="text-sm">Flows &amp; Funds</span>
          </Link>
        )}
        {collapsed && (
          <Link href="/dashboard" aria-label="Home">
            <LogoMark />
          </Link>
        )}
        {!collapsed && (
          <button
            type="button"
            onClick={toggle}
            aria-label="Collapse sidebar"
            className="cursor-pointer rounded-sm p-1 text-text-muted hover:bg-surface-offset hover:text-text"
          >
            <ChevronsLeft size={16} />
          </button>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto py-2">
        <ul className="flex flex-col gap-1 px-2">
          {navItems.map((item) => {
            const active =
              pathname === item.href || pathname?.startsWith(item.href + "/");
            const Icon = item.icon;
            const link = (
              <Link
                href={item.href}
                className={cn(
                  "flex h-9 items-center gap-3 rounded-md px-2 text-sm transition-colors",
                  collapsed && "justify-center px-0",
                  active
                    ? "bg-surface-offset text-text"
                    : "text-text-muted hover:bg-surface-offset hover:text-text",
                )}
              >
                <Icon size={18} className="shrink-0" />
                {!collapsed && <span className="truncate">{item.label}</span>}
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

      <div className="border-t p-2">
        {collapsed ? (
          <div className="flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={toggle}
              aria-label="Expand sidebar"
              className="cursor-pointer rounded-sm p-1 text-text-muted hover:bg-surface-offset hover:text-text"
            >
              <ChevronsRight size={16} />
            </button>
            <ThemeToggle compact />
            <CircleUser size={20} className="text-text-muted" />
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-offset">
                <CircleUser size={16} className="text-text-muted" />
              </div>
              <div className="min-w-0">
                <div className="truncate text-xs font-medium">Signed in</div>
                <div className="truncate text-[11px] text-text-muted">
                  local dev
                </div>
              </div>
            </div>
            <ThemeToggle compact />
          </div>
        )}
      </div>
    </aside>
  );
}

function LogoMark() {
  return (
    <div
      aria-hidden
      className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground"
    >
      <svg
        viewBox="0 0 24 24"
        width="16"
        height="16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4 6h6l4 12h6" />
        <circle cx="4" cy="6" r="1.5" />
        <circle cx="20" cy="18" r="1.5" />
      </svg>
    </div>
  );
}
