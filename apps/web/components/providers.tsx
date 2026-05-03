"use client";

import { useEffect } from "react";
import { ThemeProvider } from "next-themes";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { useUi } from "@/lib/stores/ui";
import { useVizSettings } from "@/lib/stores/visualization-settings";

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: (count, err: unknown) => {
          // Don't retry on 4xx — they're our fault, not the network's.
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
  const density = useUi((s) => s.density);

  // Reflect density on <html data-density="…"> after rehydration from localStorage.
  useEffect(() => {
    document.documentElement.dataset.density = density;
  }, [density]);

  // Rehydrate persisted UI state after mount so SSR and initial client render
  // both use the same defaults (no hydration mismatch).
  useEffect(() => {
    useUi.persist.rehydrate();
    useVizSettings.persist.rehydrate();
  }, []);

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={getQueryClient()}>
        <TooltipProvider delayDuration={300}>
          {children}
          <Toaster richColors closeButton position="bottom-right" />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
