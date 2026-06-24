"use client";

import { useEffect } from "react";
import { ThemeProvider } from "next-themes";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionProvider } from "next-auth/react";

import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { useAnalytics } from "@/lib/stores/analytics";
import { AnalyticsProvider } from "@/lib/analytics/provider";
import { ServerStateSync } from "@/components/server-state-sync";

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: (count, err: unknown) => {
          // Don't retry on 4xx – they're our fault, not the network's.
          const status = (err as { status?: number } | null)?.status;
          if (status && status >= 400 && status < 500) return false;
          return count < 2;
        },
      },
    },
  });
}

let _client: QueryClient | undefined;
function getQueryClient() {
  if (typeof window === "undefined") return makeQueryClient();
  if (!_client) _client = makeQueryClient();
  return _client;
}

/**
 * The single client-side provider stack. Keeps the root layout
 * server-rendered and dependency-free.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  // Rehydrate persisted UI state after mount so SSR and initial client render
  // both use the same defaults (no hydration mismatch).
  useEffect(() => {
    // ui + viz are now hydrated per-user from the server by <ServerStateSync/>;
    // analytics keeps its local (per-device) persistence.
    useAnalytics.persist.rehydrate();
  }, []);

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <SessionProvider>
        <ServerStateSync />
        <QueryClientProvider client={getQueryClient()}>
          <TooltipProvider delayDuration={300}>
            <AnalyticsProvider>
              {children}
              <Toaster richColors closeButton position="bottom-right" />
            </AnalyticsProvider>
          </TooltipProvider>
        </QueryClientProvider>
      </SessionProvider>
    </ThemeProvider>
  );
}
