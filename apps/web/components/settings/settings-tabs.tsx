"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/cn";

const TABS = [
  { href: "/settings/general", label: "General" },
  { href: "/settings/modules", label: "Modules" },
  { href: "/settings/about", label: "About" },
];

export function SettingsTabs() {
  const pathname = usePathname() ?? "";
  return (
    <nav className="flex gap-1 border-b border-border" aria-label="Settings sections">
      {TABS.map((t) => {
        const active = pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              "border-b-2 px-3 py-2 text-sm transition-colors cursor-pointer",
              active
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
