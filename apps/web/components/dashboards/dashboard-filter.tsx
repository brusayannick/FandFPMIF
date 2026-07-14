"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { clearAmbientHeaders, setAmbientHeaders } from "@/lib/api";
import { EVENT_FILTER_HEADER, encodeFilterHeader } from "@/components/dashboards/widget-filter";
import type { FilterEntry } from "@/lib/api-types";

/**
 * Dashboard-scoped ephemeral filtering.
 *
 * A dashboard can narrow what every one of its widgets sees via a global
 * column-filter bar (top) and a time-range slider (bottom). That scope is
 * *ephemeral* – it never mutates the log's committed Events-tab filter
 * (`EventLog.active_filter`). It travels to module endpoints as the
 * `X-FF-Event-Filter` request header (set on the ambient registry in
 * `lib/api.ts`); the backend's module-route dispatch decodes it and *replaces*
 * the committed filter for that request (see the dashboards plan + loader.py).
 *
 * To make every widget re-render with a skeleton and refetch when the filter
 * changes – without touching any widget's own fetch code – widget queries run
 * inside a *dedicated* `QueryClient` (`<DashboardWidgetScope>`). On commit we
 * update the header, then `resetQueries()` on that client: each widget drops
 * to its loading state and refetches, now carrying the new header. The blast
 * radius is the dashboard only; the rest of the app's query cache is untouched.
 */

interface DashboardFilterContextValue {
  /** Global column filters (the top bar). */
  columnFilters: FilterEntry[];
  setColumnFilters: (next: FilterEntry[]) => void;
  /** Time-range filters – 0–2 synthetic `timestamp` gte/lte entries (bottom). */
  timeFilters: FilterEntry[];
  setTimeFilters: (next: FilterEntry[]) => void;
  /** The dedicated client widget queries live in. */
  widgetQueryClient: QueryClient;
}

const DashboardFilterContext = createContext<DashboardFilterContextValue | null>(null);

export function useDashboardFilter(): DashboardFilterContextValue {
  const ctx = useContext(DashboardFilterContext);
  if (!ctx) {
    throw new Error("useDashboardFilter must be used within a DashboardFilterProvider");
  }
  return ctx;
}

/** Non-throwing variant for code that may run outside a dashboard (e.g. the
 * shared dataset-fetch hook). Returns `null` when no provider is mounted. */
export function useDashboardFilterOptional(): DashboardFilterContextValue | null {
  return useContext(DashboardFilterContext);
}

export function DashboardFilterProvider({
  children,
  initialColumnFilters = [],
  initialTimeFilters = [],
  onCommit,
}: {
  children: ReactNode;
  /** Column filters to load with – the board's committed live bar (or its active
   * saved filter). Read once on mount; later changes flow through `setColumnFilters`. */
  initialColumnFilters?: FilterEntry[];
  /** Time-range window to load with – the board's committed window (a shared
   * board seeds this from the owner). Read once on mount. */
  initialTimeFilters?: FilterEntry[];
  /** Fires (debounced, never on the initial mount) whenever the committed filter
   * view changes, so the owner can persist it on the board. Omitted for a
   * read-only recipient – their tweaks stay ephemeral. */
  onCommit?: (next: { columnFilters: FilterEntry[]; timeFilters: FilterEntry[] }) => void;
}) {
  const [columnFilters, setColumnFilters] = useState<FilterEntry[]>(initialColumnFilters);
  const [timeFilters, setTimeFilters] = useState<FilterEntry[]>(initialTimeFilters);
  // Ref so the debounced commit effect can call the latest handler without
  // re-arming the timer on every parent render.
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  // One client per provider instance – widget queries are isolated here.
  const [widgetQueryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
      }),
  );

  const combined = useMemo(
    () => [...timeFilters, ...columnFilters],
    [timeFilters, columnFilters],
  );

  // Push the committed filter onto the ambient header, and force every widget
  // to re-fetch (and skeleton) on change. Skip the work on the very first run:
  // there's nothing cached to clear and the widgets are already doing their
  // initial fetch (which must still carry the board's active saved filter).
  const firstRun = useRef(true);
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const header = combined.length > 0 ? encodeFilterHeader(combined) : null;
    if (firstRun.current) {
      firstRun.current = false;
      setAmbientHeaders({ [EVENT_FILTER_HEADER]: header });
      return;
    }
    // Debounce the commit: typing in the filter bar and dragging the time slider
    // both churn `combined` rapidly. Without this, every keystroke/tick resets
    // and refetches *every* widget at once - a thundering herd of backend
    // recomputes. Coalescing into one update per ~300ms idle means a 20-card
    // board recomputes once. resetQueries (not removeQueries): it returns each
    // widget query to pending (so the card skeletons) AND refetches the active
    // ones with the new header; removeQueries would leave mounted widgets
    // showing stale results without refetching.
    if (commitTimer.current) clearTimeout(commitTimer.current);
    commitTimer.current = setTimeout(() => {
      setAmbientHeaders({ [EVENT_FILTER_HEADER]: header });
      // Let the owner persist the committed view on the board (so it transfers
      // to share recipients). No-op for a read-only recipient (no handler).
      onCommitRef.current?.({ columnFilters, timeFilters });
      void widgetQueryClient.resetQueries();
    }, 300);
    return () => {
      if (commitTimer.current) clearTimeout(commitTimer.current);
    };
  }, [combined, columnFilters, timeFilters, widgetQueryClient]);

  // Tidy up when the dashboard unmounts so the header can't leak onto other
  // pages' requests.
  useEffect(() => () => clearAmbientHeaders(EVENT_FILTER_HEADER), []);

  const value = useMemo<DashboardFilterContextValue>(
    () => ({ columnFilters, setColumnFilters, timeFilters, setTimeFilters, widgetQueryClient }),
    [columnFilters, timeFilters, widgetQueryClient],
  );

  return (
    <DashboardFilterContext.Provider value={value}>{children}</DashboardFilterContext.Provider>
  );
}

/** Wrap the widget canvas so all its queries live in the dashboard's dedicated
 * client. Metadata queries (column specs, time bounds) should stay OUTSIDE this
 * so they aren't cleared on every filter commit. */
export function DashboardWidgetScope({ children }: { children: ReactNode }) {
  const { widgetQueryClient } = useDashboardFilter();
  return <QueryClientProvider client={widgetQueryClient}>{children}</QueryClientProvider>;
}
