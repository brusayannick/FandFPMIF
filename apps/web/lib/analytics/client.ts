"use client";

import { apiUrl } from "@/lib/api";
import { useAnalytics } from "@/lib/stores/analytics";
import { deriveUaClass } from "@/lib/analytics/dnt";

import type { EventName } from "@/lib/analytics/events";

/**
 * Tracking client — a thin queue that batches events and POSTs to
 * `/api/v1/usage/sync`. The server is the source of truth for
 * whether ingestion is on; this client gates as a UX shortcut.
 */

interface QueuedEvent {
  event_type: "page" | "click" | "custom" | "error" | "perf" | "form";
  event_name: string;
  occurred_at: string;
  path?: string | null;
  referrer?: string | null;
  properties?: Record<string, unknown> | null;
}

const FLUSH_INTERVAL_MS = 5_000;
const MAX_QUEUE_BEFORE_FLUSH = 50;
const SESSION_IDLE_MS = 30 * 60 * 1000;
// Path deliberately neutral so ad-blocker filter lists (EasyPrivacy etc.)
// don't drop our requests with `net::ERR_BLOCKED_BY_CLIENT`. Matches the
// backend `/usage` router.
const INGEST_PATH = "/api/v1/usage/sync";

let queue: QueuedEvent[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
let flushing: Promise<void> | null = null;

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  // Sufficient fallback for non-cryptographic identifiers.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function ensureSession(): { sessionId: string; started: number } {
  const s = useAnalytics.getState();
  const now = Date.now();
  const stale = s.lastActivityAt && now - s.lastActivityAt > SESSION_IDLE_MS;
  if (!s.sessionId || stale) {
    const id = uuid();
    useAnalytics.getState().beginSession(id);
    return { sessionId: id, started: now };
  }
  useAnalytics.getState().touchSession();
  return { sessionId: s.sessionId, started: s.sessionStartedAt ?? now };
}

function sessionMeta(sessionId: string, started: number) {
  const s = useAnalytics.getState();
  return {
    id: sessionId,
    anon_user_id: s.anonUserId ?? "",
    started_at: new Date(started).toISOString(),
    entry_path: typeof window !== "undefined" ? window.location.pathname : null,
    viewport_w: typeof window !== "undefined" ? window.innerWidth : null,
    viewport_h: typeof window !== "undefined" ? window.innerHeight : null,
    ua_class: deriveUaClass(),
    locale:
      typeof navigator !== "undefined" ? navigator.language || null : null,
    tz:
      typeof Intl !== "undefined"
        ? Intl.DateTimeFormat().resolvedOptions().timeZone || null
        : null,
  };
}

export function enqueueEvent(event: Omit<QueuedEvent, "occurred_at">): void {
  const s = useAnalytics.getState();
  if (!s.enabled || !s.anonUserId) return;
  queue.push({ ...event, occurred_at: new Date().toISOString() });
  if (queue.length >= MAX_QUEUE_BEFORE_FLUSH) {
    void flush();
  }
}

export function trackCustom(
  name: EventName | string,
  properties?: Record<string, unknown>,
): void {
  enqueueEvent({
    event_type: "custom",
    event_name: name,
    path:
      typeof window !== "undefined" ? window.location.pathname : null,
    properties: properties ?? null,
  });
}

export async function flush(): Promise<void> {
  if (flushing) return flushing;
  if (queue.length === 0) return;
  const s = useAnalytics.getState();
  if (!s.enabled || !s.anonUserId) {
    queue = [];
    return;
  }
  const batch = queue;
  queue = [];
  const { sessionId, started } = ensureSession();
  const payload = {
    session: sessionMeta(sessionId, started),
    events: batch,
  };
  flushing = (async () => {
    try {
      const res = await fetch(apiUrl(INGEST_PATH), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true,
      });
      // 204 means the server has disabled ingest. Sync the client so we
      // stop wasting cycles until the user re-enables.
      if (res.status === 204) {
        useAnalytics.getState().setEnabled(false);
      }
    } catch {
      // Silent: analytics must never crash the host app. Dropping a batch
      // is preferable to retry storms during a backend outage.
    } finally {
      flushing = null;
    }
  })();
  return flushing;
}

/**
 * Last-ditch flush on unload. `sendBeacon` keeps the request alive after
 * navigation but only accepts the body as a Blob — we tag it as JSON so the
 * backend's content-type-agnostic parser works.
 */
export function flushOnUnload(): void {
  if (queue.length === 0) return;
  const s = useAnalytics.getState();
  if (!s.enabled || !s.anonUserId || typeof navigator === "undefined") {
    queue = [];
    return;
  }
  const { sessionId, started } = ensureSession();
  const payload = {
    session: sessionMeta(sessionId, started),
    events: queue,
  };
  queue = [];
  try {
    const blob = new Blob([JSON.stringify(payload)], {
      type: "application/json",
    });
    navigator.sendBeacon(apiUrl(INGEST_PATH), blob);
  } catch {
    /* swallow */
  }
}

export function startFlushTimer(): void {
  if (flushTimer != null) return;
  flushTimer = setInterval(() => {
    void flush();
  }, FLUSH_INTERVAL_MS);
}

export function stopFlushTimer(): void {
  if (flushTimer != null) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
}

/** Drop any queued events without sending. Used after opt-out. */
export function discardQueue(): void {
  queue = [];
}
