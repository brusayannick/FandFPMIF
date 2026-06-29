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
 * log. The first leg (import flow) always runs. The discovery leg — the core of
 * the tour — only runs when there's a `demoLogId` to spotlight live; otherwise
 * the closing step explains that discovery unlocks once a log finishes
 * importing. This keeps the "live, end-to-end" tour robust for brand-new users
 * (who have no ready data yet) without faking a process map.
 */
export function buildTourSteps(demoLogId: string | null): TourStep[] {
  const steps: TourStep[] = [
    {
      id: "welcome",
      route: "/processes",
      title: "Welcome to Mate",
      body: "Mate turns raw event logs into living process maps. Two minutes on the platform's core: process discovery.",
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
      body: "Import a log from a file (XES / CSV), a URL, a folder, or a watched source. Mate auto-detects cases, activities and timestamps.",
    },
    {
      id: "import-form",
      route: "/processes/import",
      selector: '[data-tour="import-form"]',
      placement: "top",
      title: "Map once, mine forever",
      body: "Pick a source and confirm the column mapping. The log is stored as Parquet so modules query it in milliseconds. (We'll skip the upload for the tour.)",
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
        title: "Discovery is the heart",
        body: "Process discovery reconstructs the real process model directly from the order of events — nothing drawn by hand.",
      },
      {
        id: "discovery-canvas",
        route: `/processes/${demoLogId}/modules/discovery`,
        selector: '[data-tour="discovery-canvas"]',
        placement: "top",
        title: "Your discovered process",
        body: "This map is mined from the data: nodes are activities, edges are the paths your cases actually took.",
      },
      {
        id: "discovery-views",
        route: `/processes/${demoLogId}/modules/discovery`,
        selector: '[data-tour="discovery-views"]',
        placement: "bottom",
        title: "One process, many lenses",
        body: "Switch between Direct-Follows Graph, BPMN, Petri net, process tree and more — same data, different formalism.",
      },
      {
        id: "discovery-filters",
        route: `/processes/${demoLogId}/modules/discovery`,
        selector: '[data-tour="discovery-filters"]',
        placement: "top",
        title: "Cut the noise",
        body: "Real logs are messy. Drag Activities and Connections to keep only the most frequent behaviour — the essence of discovery.",
      },
    );
  }

  steps.push({
    id: "done",
    title: demoLogId ? "You've seen the core" : "Import a log to start mining",
    body: demoLogId
      ? "That's process discovery. Every other module builds on this map. Replay this tour anytime from Settings → General."
      : "Once your first log finishes importing, open it and the Discovery panel draws your process map. Replay this tour from Settings → General.",
  });

  return steps;
}
