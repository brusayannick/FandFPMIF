"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";

import { MateLogo } from "@/components/mate-logo";
import {
  prefetchDashboards,
  prefetchEventLogs,
  prefetchModules,
  warmSecondaryData,
} from "@/lib/client-prefetch";

/**
 * Once-per-session branded first-load screen that actually CACHES the app's
 * primary routes so the first navigation after it has no long load and no top
 * progress bar.
 *
 * How it warms a route: `fetch(route, {headers:{RSC:'1'}})` requests the route's
 * RSC payload exactly the way Next's own router does. That forces the dev server
 * (Turbopack) to COMPILE the route — the real first-visit bottleneck — during the
 * splash instead of on the user's click (verified: a cold RSC fetch ~1 s, warm
 * ~66 ms). `router.prefetch()` is ALSO called: it's a no-op in dev but in prod it
 * warms Next's Router Cache + route chunk so the click is instant there too. The
 * list DATA is warmed via React Query in parallel.
 *
 * Behavior: shown only on the first authed page of a browser session
 * (sessionStorage flag), and it WAITS until every route + the data have settled
 * (determinate N/M progress), capped by a hard timeout so a stuck compile can
 * never trap the user. SSR renders nothing (needs sessionStorage), so it fades in
 * a frame after hydration and fades back out — no hydration mismatch.
 */

const SESSION_KEY = "__ff_splash_shown_v1";
const MIN_SHOW_MS = 600; // let the logo animation register even if warming is fast
const HARD_TIMEOUT_MS = 12_000; // safety: never trap the user, even on a stuck compile
const FADE_MS = 500;

// Main nav + common sub-pages. Detail routes (`.../[id]`) are per-item and stay
// lazy (skeletons + code-split chunks), so they're deliberately not pre-warmed.
const BASE_ROUTES = [
  "/processes",
  "/dashboards",
  "/modules",
  "/settings/general",
  "/settings/privacy",
  "/settings/ai",
  "/settings/api",
  "/settings/about",
  "/processes/import",
  "/modules/import",
];
const ADMIN_ROUTES = [
  "/admin/overview",
  "/admin/jobs",
  "/admin/teams",
  "/admin/system",
  "/admin/storage",
  "/admin/controls",
  "/admin/logs",
];

export function AppSplash({ isAdmin = false }: { isAdmin?: boolean }) {
  const [state, setState] = useState<"init" | "show" | "leave" | "done">("init");
  const [warmed, setWarmed] = useState(0);
  const [total, setTotal] = useState(1);
  const router = useRouter();
  const qc = useQueryClient();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (sessionStorage.getItem(SESSION_KEY)) {
      setState("done");
      return;
    }
    sessionStorage.setItem(SESSION_KEY, "1");
    setState("show");

    const routes = isAdmin ? [...BASE_ROUTES, ...ADMIN_ROUTES] : BASE_ROUTES;
    // One extra "task" for the data-prefetch bundle so the count includes it.
    setTotal(routes.length + 1);

    const t0 = Date.now();
    let dismissed = false;
    const bump = () => setWarmed((n) => n + 1);

    // Warm a route: prod Router Cache via prefetch (dev no-op) + force the dev
    // compile by fetching its RSC payload. Read-only server render — safe.
    const warmRoute = (r: string): Promise<void> => {
      try {
        router.prefetch(r);
      } catch {
        /* best-effort */
      }
      return fetch(r, { headers: { RSC: "1" }, credentials: "include" })
        .then((res) => {
          void res.text();
        })
        .catch(() => {
          /* a failed warm just means that route compiles on click */
        });
    };

    const tasks: Promise<unknown>[] = [
      ...routes.map((r) => warmRoute(r).finally(bump)),
      Promise.allSettled([
        prefetchEventLogs(qc),
        prefetchDashboards(qc),
        prefetchModules(qc),
      ]).finally(bump),
    ];

    // Best-effort, fire-and-forget: warm the drill-down the user is most likely
    // to hit next — the top ready processes' detail + every tab, the first
    // dashboard, and (via warmRoute) those two detail ROUTES. Deliberately NOT
    // awaited and NOT part of the progress count, so it never holds the splash
    // open; it just keeps warming in the background after the fade-out.
    void warmSecondaryData(qc, warmRoute);

    const dismiss = () => {
      if (dismissed) return;
      dismissed = true;
      clearTimeout(hard);
      const wait = Math.max(0, MIN_SHOW_MS - (Date.now() - t0));
      window.setTimeout(() => {
        setState("leave");
        window.setTimeout(() => setState("done"), FADE_MS);
      }, wait);
    };

    const hard = window.setTimeout(dismiss, HARD_TIMEOUT_MS);
    void Promise.allSettled(tasks).then(dismiss);

    return () => clearTimeout(hard);
  }, [router, qc, isAdmin]);

  if (state === "init" || state === "done") return null;

  const pct = Math.min(100, Math.round((warmed / total) * 100));

  return (
    <div
      aria-hidden
      className={`fixed inset-0 z-[200] flex flex-col items-center justify-center gap-5 bg-background transition-opacity ease-out ${
        state === "leave" ? "opacity-0" : "opacity-100"
      }`}
      style={{ transitionDuration: `${FADE_MS}ms` }}
    >
      <style>{`
        @keyframes ff-splash-glow { 0%,100%{opacity:.28;transform:scale(1)} 50%{opacity:.55;transform:scale(1.12)} }
        @media (prefers-reduced-motion: reduce){ .ff-splash-anim{animation:none!important} }
      `}</style>

      <div className="relative">
        <div
          className="ff-splash-anim pointer-events-none absolute inset-0 -m-2 rounded-2xl bg-primary/30 blur-2xl"
          style={{ animation: "ff-splash-glow 1.8s ease-in-out infinite" }}
        />
        <MateLogo
          animated
          className="relative h-16 w-16 text-foreground duration-700 animate-in fade-in-0 zoom-in-50"
        />
      </div>

      <div className="flex flex-col items-center gap-1 text-center duration-700 animate-in fade-in-0 slide-in-from-bottom-2">
        <span className="text-lg font-semibold tracking-tight">PM-MATE</span>
        <span className="text-xs text-muted-foreground">
          Caching workspace… {Math.min(warmed, total)}/{total}
        </span>
      </div>

      <div className="mt-1 h-0.5 w-40 overflow-hidden rounded-full bg-border">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
          style={{ width: `${Math.max(pct, 6)}%` }}
        />
      </div>
    </div>
  );
}
