"use client";

import { create } from "zustand";
import { EtaTracker } from "@/lib/eta";
import type { JobDetail } from "@/lib/api-types";

/**
 * Live job-state store. Hydrated once by the `JobsProvider` from
 * `GET /api/v1/jobs` on mount, then patched in real time from
 * `WS /api/v1/events?topic=job.*` and from the focused `WS /jobs/{id}/stream`.
 *
 * The Sonner toasts, the bottom-left dock, and the drawer all subscribe to
 * narrow slices of this store via tiny selectors so re-renders stay cheap
 * during high-frequency progress events.
 */

interface JobLive extends JobDetail {
  // Frontend-only adornments
  rate_local?: number | null;
  eta_local?: number | null;
}

interface State {
  byId: Map<string, JobLive>;
  drawerOpen: boolean;
  paused: boolean;
  finishedHidden: boolean;

  setAll: (rows: JobDetail[]) => void;
  upsert: (job: Partial<JobLive> & { id: string }) => void;
  applyEvent: (topic: string, payload: Record<string, unknown>) => void;
  setDrawerOpen: (open: boolean) => void;
  setPaused: (paused: boolean) => void;
  setFinishedHidden: (hidden: boolean) => void;
  remove: (id: string) => void;
  clearFinished: () => void;
}

const trackers = new Map<string, EtaTracker>();

function tracker(id: string): EtaTracker {
  let t = trackers.get(id);
  if (!t) {
    t = new EtaTracker();
    trackers.set(id, t);
  }
  return t;
}

export const useJobsStore = create<State>((set, get) => {
  const finishedHidden = typeof localStorage !== "undefined"
    ? localStorage.getItem("ff.jobs.finishedHidden") === "true"
    : false;

  return {
    byId: new Map(),
    drawerOpen: false,
    paused: false,
    finishedHidden,

  setAll: (rows) => {
    const byId = new Map<string, JobLive>();
    for (const r of rows) byId.set(r.id, { ...r });
    set({ byId });
  },

  upsert: (job) => {
    const byId = new Map(get().byId);
    const prev = byId.get(job.id);
    byId.set(job.id, { ...(prev ?? {}), ...job } as JobLive);
    set({ byId });
  },

  applyEvent: (topic, payload) => {
    const id = (payload.id as string | undefined) ?? "";
    if (!id && topic.startsWith("job.")) return;

    if (topic === "job.queue.paused") {
      set({ paused: true });
      return;
    }
    if (topic === "job.queue.resumed") {
      set({ paused: false });
      return;
    }

    const byId = new Map(get().byId);
    const prev = byId.get(id);

    if (topic === "job.queued") {
      const base: LiveJob = {
        id,
        type: (payload.type as string) ?? "unknown",
        title: (payload.title as string) ?? id,
        subtitle: (payload.subtitle as string | null) ?? null,
        module_id: (payload.module_id as string | null) ?? null,
        payload_json: {},
        status: "queued",
        progress_current: 0,
        progress_total: null,
        stage: null,
        message: null,
        error: null,
        rate: null,
        eta_seconds: null,
        priority: (payload.priority as number) ?? 0,
        parent_job_id: null,
        created_at: new Date().toISOString(),
        started_at: null,
        finished_at: null,
      };
      byId.set(id, { ...base, ...(prev ?? {}), status: "queued" });
    } else if (topic === "job.started") {
      byId.set(id, {
        ...(prev as JobLive),
        id,
        status: "running",
        started_at: prev?.started_at ?? new Date().toISOString(),
      });
      tracker(id).reset();
    } else if (topic === "job.progress") {
      const t = tracker(id);
      const cur = (payload.current as number | undefined) ?? prev?.progress_current ?? 0;
      const total = (payload.total as number | null | undefined) ?? prev?.progress_total ?? null;
      t.observe(cur);
      const localRate = t.ratePerSecond();
      const localEta = t.estimateSeconds(total ?? null);
      byId.set(id, {
        ...(prev as JobLive),
        id,
        status: "running",
        progress_current: cur,
        progress_total: total ?? null,
        stage: (payload.stage as string | null) ?? prev?.stage ?? null,
        message: (payload.message as string | null) ?? prev?.message ?? null,
        rate: (payload.rate as number | null) ?? prev?.rate ?? null,
        eta_seconds: (payload.eta_seconds as number | null) ?? prev?.eta_seconds ?? null,
        rate_local: localRate,
        eta_local: localEta,
      });
    } else if (topic === "job.completed") {
      byId.set(id, {
        ...(prev as JobLive),
        id,
        status: "completed",
        finished_at: new Date().toISOString(),
        progress_current: prev?.progress_total ?? prev?.progress_current ?? 0,
      });
      trackers.delete(id);
    } else if (topic === "job.failed") {
      byId.set(id, {
        ...(prev as JobLive),
        id,
        status: "failed",
        error: (payload.error as string | null) ?? null,
        finished_at: new Date().toISOString(),
      });
      trackers.delete(id);
    } else if (topic === "job.cancelled") {
      byId.delete(id);
      trackers.delete(id);
    } else if (topic === "job.snapshot") {
      // Per-job WS sends an initial snapshot — overwrite cleanly.
      byId.set(id, payload as unknown as JobLive);
    } else {
      return;
    }

    set({ byId });
  },

  setDrawerOpen: (drawerOpen) => set({ drawerOpen }),
  setPaused: (paused) => set({ paused }),
  setFinishedHidden: (finishedHidden) => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("ff.jobs.finishedHidden", finishedHidden.toString());
    }
    set({ finishedHidden });
  },

  remove: (id) => {
    const byId = new Map(get().byId);
    byId.delete(id);
    trackers.delete(id);
    set({ byId });
  },

  clearFinished: () => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("ff.jobs.finishedHidden", "true");
    }
    set({ finishedHidden: true });
  },
  };
});

export type LiveJob = JobLive;

export type JobTypeCategory = "Import" | "Precompute" | "Module" | "Other";

export function categorizeJobType(job: LiveJob): JobTypeCategory {
  const type = job.type.toLowerCase();
  if (type.includes("import")) return "Import";
  if (type.includes("module.install")) return "Module";
  if (type.includes("module.")) return "Precompute";
  return "Other";
}

// Job titles use " — " (em-dash) as a separator between a "type" part and a
// "name" part. Which side is which depends on the job kind:
//   "Import — env_permit"      → badge: Import,      name: env_permit
//   "Discovery — precompute"   → badge: precompute,   name: Discovery
// Known type-prefixes (first part) are treated as the badge; everything else
// is assumed to be name-first, type-last.
const TITLE_TYPE_PREFIXES = new Set(["import", "export"]);

export function parseJobTitle(job: LiveJob): { name: string; badge: string } {
  const SEP = " — "; // " — "
  const { title } = job;

  if (!title.includes(SEP)) {
    return { name: title, badge: categorizeJobType(job) };
  }

  const idx = title.indexOf(SEP);
  const first = title.slice(0, idx);
  const rest = title.slice(idx + SEP.length);

  if (TITLE_TYPE_PREFIXES.has(first.toLowerCase())) {
    return { name: rest, badge: first };
  }

  return { name: first, badge: rest };
}

/* -------- selectors -------- */

const ACTIVE = new Set(["queued", "running", "paused"]);
const FINISHED = new Set(["completed", "failed", "cancelled"]);

export const selectActiveJobs = (s: State): LiveJob[] => {
  const out: LiveJob[] = [];
  for (const j of s.byId.values()) if (ACTIVE.has(j.status)) out.push(j);
  return out.sort((a, b) => (b.created_at < a.created_at ? -1 : 1));
};

export const selectFinishedJobs = (s: State): LiveJob[] => {
  if (s.finishedHidden) return [];
  const out: LiveJob[] = [];
  for (const j of s.byId.values()) if (FINISHED.has(j.status)) out.push(j);
  return out.sort((a, b) => (a.finished_at ?? a.created_at) > (b.finished_at ?? b.created_at) ? -1 : 1);
};

export const selectCounts = (s: State) => {
  let running = 0;
  let queued = 0;
  let finished = 0;
  for (const j of s.byId.values()) {
    if (j.status === "running") running++;
    else if (j.status === "queued" || j.status === "paused") queued++;
    else if (FINISHED.has(j.status)) finished++;
  }
  return { running, queued, finished };
};
