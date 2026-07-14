import type { ReactNode } from "react";

/**
 * One step of the interactive product tour. `route` is the exact pathname the
 * overlay drives to before resolving `selector`; omit `selector` for a centered,
 * target-less step (welcome / done). The overlay polls for the selector after
 * navigating, so a step can point at an element that only mounts on its route.
 */
export interface TourStep {
  id: string;
  /** Pathname to navigate to before resolving the target (omit = stay put). */
  route?: string;
  /** CSS selector to spotlight; omit for a centered, target-less step. */
  selector?: string;
  title: string;
  body: ReactNode;
  placement?: "top" | "bottom" | "left" | "right";
}

/**
 * Build the step list, adapting to whether the user already has a ready event
 * log. The tour stays HIGH-LEVEL on purpose: it walks the platform's shape and
 * the core loop — import → open a process → run modules — and never drills into
 * a single module's internals (each module's own panel does that).
 *
 * It deliberately does NOT re-teach the import form either — the setup wizard
 * owns the hands-on upload (it embeds the very same `ImportForm`); the tour only
 * points at where importing lives in the real UI, so the two first-run
 * experiences complement instead of repeating each other. The "open a process →
 * modules" leg only runs when there's a `demoLogId` to spotlight live; otherwise
 * the closing step explains that modules unlock once a log finishes importing.
 * This keeps the walkthrough robust for brand-new users (who have no ready data
 * yet) without faking a process map.
 *
 * `auto` = launched straight off the setup wizard's Finish: the opener
 * acknowledges setup instead of greeting the user a second time.
 */
export function buildTourSteps(
  demoLogId: string | null,
  opts?: { auto?: boolean },
): TourStep[] {
  const steps: TourStep[] = [
    opts?.auto
      ? {
          id: "welcome",
          route: "/processes",
          title: "Setup complete — now the live tour",
          body: "Two minutes in the real UI: where your data lives and how the core loop — import, open, analyse — fits together. Skip anytime; replay later from Settings → About.",
        }
      : {
          id: "welcome",
          route: "/processes",
          title: "Welcome to Mate",
          body: "Mate turns raw event logs into living process maps. Two minutes on the essentials: import a log, open it, and let its modules analyse it.",
        },
    {
      id: "nav-processes",
      route: "/processes",
      selector: '[data-tour="nav-processes"]',
      placement: "right",
      title: "Everything starts here",
      body: "Processes is home base — every analysis begins from an imported event log.",
    },
    {
      id: "import-log",
      route: "/processes",
      selector: '[data-tour="import-log"]',
      placement: "bottom",
      title: "Bring in your data",
      body: "New data lands here — upload a file, pull from a URL, or connect a watched folder that imports new logs automatically.",
    },
  ];

  if (demoLogId) {
    steps.push(
      {
        id: "open-process",
        route: "/processes",
        selector: `[data-log-id="${demoLogId}"]`,
        placement: "bottom",
        title: "Open a process",
        body: "Ready logs land in this list. Open one to unlock its analysis modules.",
      },
      {
        id: "module-grid",
        route: `/processes/${demoLogId}`,
        selector: '[data-tour="module-grid"]',
        placement: "top",
        title: "Modules do the analysis",
        body: "Each card is a self-contained analysis — performance, conformance, complexity… all running on this one log.",
      },
      {
        id: "discovery-card",
        route: `/processes/${demoLogId}`,
        selector: '[data-tour="module-discovery"]',
        placement: "bottom",
        title: "Start with Discovery",
        body: "Discovery mines a process map straight from your events — the usual first stop. Open any card to run that analysis on this log.",
      },
    );
  }

  steps.push({
    id: "done",
    title: demoLogId ? "That's the core loop" : "Import a log to start",
    body: demoLogId
      ? "Import a log, open it, and each module analyses it in place — start with the Discovery map, then layer on performance, conformance and more. Replay this tour anytime from Settings → About."
      : "Once your first log finishes importing, open it and its modules light up — starting with the Discovery map. Replay this tour anytime from Settings → About.",
  });

  return steps;
}
