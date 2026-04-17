"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, ChevronRight, Search } from "lucide-react";

function toSegmentLabel(segment: string): string {
  return segment
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function useBreadcrumbs() {
  const pathname = usePathname() ?? "/";
  const segments = pathname.split("/").filter(Boolean);
  const root = { label: "Platform", href: "/dashboard" };
  const crumbs: { label: string; href: string }[] = [root];
  let acc = "";
  for (const seg of segments) {
    acc += "/" + seg;
    if (acc !== root.href) {
      crumbs.push({ label: toSegmentLabel(seg), href: acc });
    }
  }
  return crumbs;
}

export function Topbar() {
  const crumbs = useBreadcrumbs();

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b bg-background px-4">
      <nav aria-label="Breadcrumb" className="min-w-0 overflow-hidden">
        <ol className="flex items-center gap-1 text-sm">
          {crumbs.map((c, i) => {
            const last = i === crumbs.length - 1;
            return (
              <li
                key={c.href}
                className="flex items-center gap-1 whitespace-nowrap"
              >
                {i > 0 && (
                  <ChevronRight
                    size={14}
                    className="text-text-faint"
                    aria-hidden
                  />
                )}
                {last ? (
                  <span className="text-text">{c.label}</span>
                ) : (
                  <Link
                    href={c.href}
                    className="text-text-muted hover:text-text"
                  >
                    {c.label}
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="flex items-center gap-2">
        <div className="relative hidden md:block">
          <Search
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-faint"
            aria-hidden
          />
          <input
            type="search"
            placeholder="Search processes, modules…"
            className="h-8 w-64 rounded-md border bg-surface pl-8 pr-2 text-xs text-text placeholder:text-text-faint focus:outline-none focus:ring-2 focus:ring-ring/40"
          />
        </div>
        <button
          type="button"
          aria-label="Notifications"
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-surface-offset hover:text-text"
        >
          <Bell size={16} />
        </button>
      </div>
    </header>
  );
}
