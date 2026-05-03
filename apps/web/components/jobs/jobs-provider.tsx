"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { subscribeBus } from "@/lib/ws";
import { useJobsStore } from "@/lib/stores/jobs";
import { useUi } from "@/lib/stores/ui";
import { queryKeys } from "@/lib/queries";
import type { JobDetail } from "@/lib/api-types";

/**
 * Mounts once in the platform layout. Hydrates the jobs store, subscribes to
 * `WS /events?topic=job.*` for the lifetime of the session, fans events into
 * the store, fires Sonner toasts (debounced), and invalidates TanStack
 * caches that depend on job state (event-logs list when an import completes).
 */
export function JobsProvider() {
  const setAll = useJobsStore((s) => s.setAll);
  const apply = useJobsStore((s) => s.applyEvent);
  const muted = useUi((s) => s.notificationsMuted);
  const qc = useQueryClient();
  const router = useRouter();

  const queuedToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queuedBuffer = useRef<{ title: string; id: string }[]>([]);

  // Initial hydration.
  useEffect(() => {
    let cancelled = false;
    api<JobDetail[]>("/api/v1/jobs?limit=100")
      .then((rows) => {
        if (!cancelled) setAll(rows);
      })
      .catch(() => {
        /* the dock falls back to "no jobs yet" — non-fatal */
      });
    return () => {
      cancelled = true;
    };
  }, [setAll]);

  useEffect(() => {
    const sub = subscribeBus<Record<string, unknown>>(["job.*"], (env) => {
      apply(env.topic, env.payload);

      const id = (env.payload.id as string | undefined) ?? "";
      const title = (env.payload.title as string | undefined) ?? id;

      if (env.topic === "job.queued") {
        if (muted) return;
        queuedBuffer.current.push({ title, id });
        if (queuedToastTimer.current) clearTimeout(queuedToastTimer.current);
        queuedToastTimer.current = setTimeout(() => {
          const buf = queuedBuffer.current;
          queuedBuffer.current = [];
          if (buf.length === 1) {
            toast.info(`Queued — ${buf[0].title}`, {
              action: {
                label: "View",
                onClick: () => useJobsStore.getState().setDrawerOpen(true),
              },
            });
          } else if (buf.length > 1) {
            toast.info(`${buf.length} jobs queued`, {
              action: {
                label: "View",
                onClick: () => useJobsStore.getState().setDrawerOpen(true),
              },
            });
          }
        }, 200);
        return;
      }

      if (env.topic === "job.completed") {
        // Refresh anything keyed off the api state. Event-log imports flip a
        // log row from `importing` → `ready`, so the /processes table needs
        // to refetch.
        qc.invalidateQueries({ queryKey: queryKeys.eventLogs() });
        const type = (env.payload.type as string | undefined) ?? "";
        if (type === "event_log.import") {
          const job = useJobsStore.getState().byId.get(id);
          const logId = (job?.payload_json as { log_id?: string } | undefined)?.log_id;
          if (!muted) {
            toast.success(`Imported — ${title}`, {
              action: logId
                ? {
                    label: "Open",
                    onClick: () => router.push(`/processes/${logId}`),
                  }
                : undefined,
            });
          }
        } else if (!muted) {
          toast.success(`Completed — ${title}`);
        }
        return;
      }

      if (env.topic === "job.failed") {
        toast.error(`Failed — ${title}`, {
          duration: Number.POSITIVE_INFINITY,
          action: {
            label: "Details",
            onClick: () => useJobsStore.getState().setDrawerOpen(true),
          },
        });
        return;
      }

      if (env.topic === "job.cancelled" && !muted) {
        toast.warning(`Cancelled — ${title}`);
        return;
      }
    });

    return () => sub.close();
  }, [apply, muted, qc, router]);

  return null;
}
