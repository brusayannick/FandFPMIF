"use client";

import { useState } from "react";
import { ArrowUp, FileText, Lightbulb, Sparkles, X, Zap } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/cn";
import { useUi } from "@/lib/stores/ui";

const SUGGESTIONS: { icon: React.ComponentType<{ className?: string }>; title: string; subtitle: string }[] = [
  {
    icon: FileText,
    title: "Summarize this process",
    subtitle: "Get a quick overview of variants and bottlenecks",
  },
  {
    icon: Lightbulb,
    title: "Explain a variant",
    subtitle: "Walk me through how a specific path flows",
  },
  {
    icon: Zap,
    title: "Find bottlenecks",
    subtitle: "Highlight the slowest steps across cases",
  },
];

export function AtlasAiSidebar() {
  const open = useUi((s) => s.atlasOpen);
  const setOpen = useUi((s) => s.setAtlasOpen);
  const [draft, setDraft] = useState("");

  return (
    <aside
      aria-label="ATLAS AI assistant"
      aria-hidden={!open}
      className={cn(
        "flex h-full shrink-0 flex-col overflow-hidden border-l border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-300 ease-in-out",
        open ? "w-[380px]" : "w-0 border-l-0",
      )}
    >
      <div className="flex h-full w-[380px] min-w-[380px] flex-col">
        <header className="flex items-center gap-2.5 border-b border-sidebar-border px-4 py-3">
          <div
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground"
            aria-hidden
          >
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="truncate text-sm font-semibold tracking-tight">ATLAS AI</span>
            <Badge
              variant="secondary"
              className="h-4 border-0 bg-sidebar-accent px-1.5 text-[10px] font-medium uppercase tracking-wide text-sidebar-accent-foreground/70"
            >
              Beta
            </Badge>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Close ATLAS AI"
            onClick={() => setOpen(false)}
            className="h-8 w-8 cursor-pointer text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            <X className="h-4 w-4" />
          </Button>
        </header>

        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col items-center px-5 pt-12 pb-6 text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-sidebar-primary/10 text-sidebar-primary">
              <Sparkles className="h-6 w-6" />
            </div>
            <h2 className="text-base font-semibold tracking-tight text-sidebar-foreground">
              How can I help?
            </h2>
            <p className="mt-1.5 text-xs text-sidebar-foreground/60">
              Ask me anything about your processes, variants, or modules.
            </p>
          </div>

          <div className="space-y-2 px-4 pb-6">
            {SUGGESTIONS.map((s) => {
              const Icon = s.icon;
              return (
                <button
                  key={s.title}
                  type="button"
                  className={cn(
                    "group flex w-full cursor-pointer items-start gap-3 rounded-lg border border-sidebar-border bg-sidebar-accent/30 p-3 text-left transition-colors",
                    "hover:border-sidebar-border/80 hover:bg-sidebar-accent/60",
                  )}
                >
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-sidebar text-sidebar-foreground/70 group-hover:text-sidebar-foreground">
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium text-sidebar-foreground">{s.title}</div>
                    <div className="mt-0.5 text-[11px] text-sidebar-foreground/55">{s.subtitle}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </ScrollArea>

        <div className="border-t border-sidebar-border px-3 py-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
            }}
            className="relative rounded-xl border border-input bg-background shadow-sm focus-within:ring-1 focus-within:ring-ring/40"
          >
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Ask ATLAS AI…"
              rows={2}
              className={cn(
                "block w-full resize-none rounded-xl bg-transparent px-3 py-2.5 pr-11 text-sm text-foreground placeholder:text-muted-foreground",
                "min-h-[56px] max-h-[160px] focus:outline-none",
              )}
            />
            <Button
              type="submit"
              size="icon"
              disabled={draft.trim().length === 0}
              aria-label="Send message"
              className="absolute right-2 bottom-2 h-7 w-7 cursor-pointer rounded-md"
            >
              <ArrowUp className="h-3.5 w-3.5" />
            </Button>
          </form>
          <p className="mt-2 px-1 text-[10px] text-sidebar-foreground/40">
            ATLAS AI can make mistakes. Verify important details.
          </p>
        </div>
      </div>
    </aside>
  );
}
