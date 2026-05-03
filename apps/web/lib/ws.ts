"use client";

/**
 * WebSocket helpers used by the Jobs UI (phase 8).
 *
 * `subscribeBus` opens `WS /api/v1/events?topic=…` (one per session) for
 * topic-filtered fan-out. `subscribeJob` opens `WS /api/v1/jobs/{id}/stream`
 * for high-frequency progress on a focused job.
 *
 * Both reconnect with exponential backoff (capped at 8s) so a transient
 * network blip never silently breaks the toast/dock pipeline.
 */

import { wsUrl } from "@/lib/api";
import type { BusEnvelope } from "@/lib/api-types";

type Listener<T> = (env: BusEnvelope<T>) => void;

interface Subscription {
  close: () => void;
}

const BACKOFF_MS = [250, 500, 1000, 2000, 4000, 8000];

function buildBusUrl(topics: string[]): string {
  const qs = topics.map((t) => `topic=${encodeURIComponent(t)}`).join("&");
  return wsUrl(`/api/v1/events${qs ? `?${qs}` : ""}`);
}

export function subscribeBus<T = Record<string, unknown>>(
  topics: string[],
  onMessage: Listener<T>,
): Subscription {
  let attempt = 0;
  let socket: WebSocket | null = null;
  let closed = false;

  const open = () => {
    if (closed) return;
    socket = new WebSocket(buildBusUrl(topics));
    socket.onopen = () => {
      attempt = 0;
    };
    socket.onmessage = (ev) => {
      try {
        onMessage(JSON.parse(ev.data) as BusEnvelope<T>);
      } catch (err) {
        console.error("ws.bus.parse_error", err);
      }
    };
    socket.onclose = () => {
      if (closed) return;
      const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
      attempt += 1;
      setTimeout(open, delay);
    };
    socket.onerror = () => {
      socket?.close();
    };
  };

  open();

  return {
    close: () => {
      closed = true;
      socket?.close();
    },
  };
}

export function subscribeJob<T = Record<string, unknown>>(
  jobId: string,
  onMessage: Listener<T>,
): Subscription {
  let attempt = 0;
  let socket: WebSocket | null = null;
  let closed = false;

  const open = () => {
    if (closed) return;
    socket = new WebSocket(wsUrl(`/api/v1/jobs/${encodeURIComponent(jobId)}/stream`));
    socket.onopen = () => {
      attempt = 0;
    };
    socket.onmessage = (ev) => {
      try {
        onMessage(JSON.parse(ev.data) as BusEnvelope<T>);
      } catch (err) {
        console.error("ws.job.parse_error", err);
      }
    };
    socket.onclose = (ev) => {
      if (closed) return;
      // 4404 = job not found; don't retry
      if (ev.code === 4404) return;
      const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
      attempt += 1;
      setTimeout(open, delay);
    };
    socket.onerror = () => {
      socket?.close();
    };
  };

  open();

  return {
    close: () => {
      closed = true;
      socket?.close();
    },
  };
}
