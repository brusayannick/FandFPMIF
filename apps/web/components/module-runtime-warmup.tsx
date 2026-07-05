"use client";

import { useEffect } from "react";

import { installModuleRuntime } from "@/lib/module-runtime";

/**
 * Warms the module runtime (the ~30 dynamic imports behind
 * `window.__FF_RUNTIME__`: recharts, xyflow, radix, …) during browser idle
 * time after the platform shell mounts, so the first module panel a user
 * opens doesn't pay the whole install on click. `installModuleRuntime()` is
 * idempotent – a panel opened before the idle callback fires simply awaits
 * the same in-flight promise.
 */
export function ModuleRuntimeWarmup() {
  useEffect(() => {
    const warm = () => void installModuleRuntime();
    // Safari still lacks requestIdleCallback – fall back to a short timeout.
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(warm, { timeout: 5000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(warm, 2500);
    return () => window.clearTimeout(id);
  }, []);
  return null;
}
