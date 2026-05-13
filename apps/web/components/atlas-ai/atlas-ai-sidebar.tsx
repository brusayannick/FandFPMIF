"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowUp,
  FileText,
  Lightbulb,
  RotateCcw,
  Sparkles,
  X,
  Zap,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { rawFetch } from "@/lib/api";
import { useAiConfig } from "@/lib/ai-queries";
import { useUi } from "@/lib/stores/ui";

interface Message {
  role: "user" | "assistant";
  content: string;
  isError?: boolean;
}

const SUGGESTIONS = [
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

// --------------------------------------------------------------------------
// Sub-components
// --------------------------------------------------------------------------

function StreamingSkeleton() {
  return (
    <div className="space-y-2.5 py-0.5">
      <div
        className="h-2.5 w-4/5 animate-pulse rounded-full bg-sidebar-foreground/15"
        style={{ animationDelay: "0ms" }}
      />
      <div
        className="h-2.5 w-3/5 animate-pulse rounded-full bg-sidebar-foreground/15"
        style={{ animationDelay: "180ms" }}
      />
      <div
        className="h-2.5 w-11/12 animate-pulse rounded-full bg-sidebar-foreground/15"
        style={{ animationDelay: "360ms" }}
      />
    </div>
  );
}

function UserBubble({ content }: { content: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-sidebar-primary px-3.5 py-2.5 text-sm text-sidebar-primary-foreground shadow-sm">
        <p className="whitespace-pre-wrap break-words leading-relaxed">{content}</p>
      </div>
    </div>
  );
}

function AssistantBubble({
  content,
  isError,
  isStreaming,
}: {
  content: string;
  isError?: boolean;
  isStreaming?: boolean;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <div
        className={cn(
          "mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
          isError
            ? "bg-destructive/20 text-destructive"
            : "bg-sidebar-primary/15 text-sidebar-primary",
          isStreaming && !content && "animate-pulse",
        )}
      >
        {isError ? (
          <AlertTriangle className="h-3 w-3" />
        ) : (
          <Sparkles className="h-3 w-3" />
        )}
      </div>
      <div
        className={cn(
          "min-w-0 flex-1 rounded-2xl rounded-tl-sm px-3.5 py-2.5 text-sm shadow-sm",
          isError
            ? "border border-destructive/20 bg-destructive/10 text-destructive"
            : "bg-sidebar-accent/60 text-sidebar-foreground",
        )}
      >
        {isStreaming && content === "" ? (
          <StreamingSkeleton />
        ) : (
          <>
            <p className="whitespace-pre-wrap break-words leading-relaxed">{content}</p>
            {isStreaming && (
              <span
                aria-hidden
                className="ml-0.5 inline-block h-[0.85em] w-0.5 translate-y-[2px] animate-pulse rounded-sm bg-current opacity-60"
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------
// Main sidebar
// --------------------------------------------------------------------------

export function AtlasAiSidebar() {
  const open = useUi((s) => s.atlasOpen);
  const setOpen = useUi((s) => s.setAtlasOpen);
  const { data: aiConfig } = useAiConfig();

  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [streamingContent, setStreamingContent] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isStreaming = streamingContent !== null;
  const hasMessages = messages.length > 0 || isStreaming;
  const isConfigured = Boolean(aiConfig?.selected_provider && aiConfig?.selected_model);

  // Scroll to bottom whenever content changes
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streamingContent]);

  // Focus textarea when sidebar opens
  useEffect(() => {
    if (open) setTimeout(() => textareaRef.current?.focus(), 310);
  }, [open]);

  const submit = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isStreaming) return;

    const userMsg: Message = { role: "user", content: trimmed };
    const history: Message[] = [...messages, userMsg];
    setMessages(history);
    setStreamingContent("");
    setDraft("");

    // Only send non-error messages to the API
    const apiMessages = history
      .filter((m) => !m.isError)
      .map((m) => ({ role: m.role, content: m.content }));

    let full = "";
    let finalised = false;

    const finalise = (content: string, isError = false) => {
      if (finalised) return;
      finalised = true;
      setMessages((prev) => [...prev, { role: "assistant", content, isError }]);
      setStreamingContent(null);
    };

    try {
      const res = await rawFetch("/api/v1/ai/chat", {
        method: "POST",
        json: { messages: apiMessages },
      });

      if (!res.ok) {
        let detail: string;
        try {
          const body = await res.json();
          detail =
            typeof body?.detail === "string" ? body.detail : JSON.stringify(body?.detail ?? body);
        } catch {
          detail = await res.text();
        }
        finalise(detail, true);
        return;
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          try {
            const evt = JSON.parse(line.slice(5).trim()) as {
              delta?: string;
              done?: boolean;
              error?: string;
            };
            if (evt.delta) {
              full += evt.delta;
              setStreamingContent(full);
            }
            if (evt.done) finalise(full);
            if (evt.error) finalise(evt.error, true);
          } catch {
            // malformed SSE chunk
          }
        }
      }

      // Safety: if stream ended without a done/error event
      if (!finalised) finalise(full || "No response received.");
    } catch (err) {
      finalise((err as Error).message, true);
    }
  };

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
        {/* Header */}
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
          {hasMessages && (
            <button
              type="button"
              aria-label="New conversation"
              onClick={() => {
                setMessages([]);
                setStreamingContent(null);
              }}
              className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-sidebar-foreground/50 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          )}
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

        {/* Message area */}
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
          {!hasMessages ? (
            /* Welcome / empty state */
            <div className="flex flex-col items-center px-5 pt-12 pb-6 text-center">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-sidebar-primary/10 text-sidebar-primary">
                <Sparkles className="h-6 w-6" />
              </div>
              <h2 className="text-base font-semibold tracking-tight">How can I help?</h2>
              <p className="mt-1.5 text-xs text-sidebar-foreground/60">
                Ask me anything about your processes, variants, or modules.
              </p>

              {!isConfigured && aiConfig !== undefined && (
                <div className="mt-4 w-full rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-left text-xs text-amber-700 dark:text-amber-400">
                  No AI model configured.{" "}
                  <a
                    href="/settings/ai"
                    className="font-medium underline underline-offset-2"
                  >
                    Settings → AI
                  </a>{" "}
                  to set one up.
                </div>
              )}

              <div className="mt-6 w-full space-y-2">
                {SUGGESTIONS.map((s) => {
                  const Icon = s.icon;
                  return (
                    <button
                      key={s.title}
                      type="button"
                      disabled={!isConfigured || isStreaming}
                      onClick={() => void submit(s.title)}
                      className={cn(
                        "group flex w-full cursor-pointer items-start gap-3 rounded-lg border border-sidebar-border bg-sidebar-accent/30 p-3 text-left transition-colors",
                        "hover:border-sidebar-border/80 hover:bg-sidebar-accent/60",
                        "disabled:cursor-not-allowed disabled:opacity-40",
                      )}
                    >
                      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-sidebar text-sidebar-foreground/70 group-hover:text-sidebar-foreground">
                        <Icon className="h-3.5 w-3.5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-medium text-sidebar-foreground">
                          {s.title}
                        </div>
                        <div className="mt-0.5 text-[11px] text-sidebar-foreground/55">
                          {s.subtitle}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            /* Conversation */
            <div className="flex flex-col gap-4 px-4 py-4">
              {messages.map((msg, i) =>
                msg.role === "user" ? (
                  <UserBubble key={i} content={msg.content} />
                ) : (
                  <AssistantBubble key={i} content={msg.content} isError={msg.isError} />
                ),
              )}
              {isStreaming && (
                <AssistantBubble content={streamingContent ?? ""} isStreaming />
              )}
              {/* Bottom anchor for auto-scroll */}
              <div className="h-px" />
            </div>
          )}
        </div>

        {/* Input */}
        <div className="border-t border-sidebar-border px-3 py-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit(draft);
            }}
            className="relative rounded-xl border border-input bg-background shadow-sm focus-within:ring-1 focus-within:ring-ring/40"
          >
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void submit(draft);
                }
              }}
              placeholder={
                isStreaming
                  ? "Waiting for response…"
                  : "Ask ATLAS AI… (Enter to send)"
              }
              rows={2}
              disabled={isStreaming}
              className={cn(
                "block w-full resize-none rounded-xl bg-transparent px-3 py-2.5 pr-11 text-sm text-foreground placeholder:text-muted-foreground",
                "min-h-[56px] max-h-[160px] focus:outline-none",
                "disabled:cursor-not-allowed disabled:opacity-50",
              )}
            />
            <Button
              type="submit"
              size="icon"
              disabled={!draft.trim() || isStreaming}
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
