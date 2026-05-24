"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

interface UiState {
  sidebarCollapsed: boolean;
  showUnavailableModules: boolean;
  showDisabledModules: boolean;
  notificationsMuted: boolean;
  atlasOpen: boolean;
  // Locale + import defaults — used by Settings → General and pre-filled
  // into the CSV import form so users don't re-pick them every upload
  // (§7.6.1).
  timezone: string;
  dateFormat: "iso" | "us" | "eu";
  csvDelimiter: "," | ";" | "\t" | "|";
  csvTimestampFormat: string;
  toggleSidebar: () => void;
  setShowUnavailableModules: (v: boolean) => void;
  setShowDisabledModules: (v: boolean) => void;
  setNotificationsMuted: (v: boolean) => void;
  toggleAtlas: () => void;
  setAtlasOpen: (v: boolean) => void;
  setTimezone: (v: string) => void;
  setDateFormat: (v: "iso" | "us" | "eu") => void;
  setCsvDelimiter: (v: "," | ";" | "\t" | "|") => void;
  setCsvTimestampFormat: (v: string) => void;
}

const DEFAULT_TIMEZONE = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
})();

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      showUnavailableModules: true,
      showDisabledModules: false,
      notificationsMuted: false,
      atlasOpen: false,
      timezone: DEFAULT_TIMEZONE,
      dateFormat: "iso",
      csvDelimiter: ",",
      csvTimestampFormat: "",
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setShowUnavailableModules: (v) => set({ showUnavailableModules: v }),
      setShowDisabledModules: (v) => set({ showDisabledModules: v }),
      setNotificationsMuted: (v) => set({ notificationsMuted: v }),
      toggleAtlas: () => set((s) => ({ atlasOpen: !s.atlasOpen })),
      setAtlasOpen: (v) => set({ atlasOpen: v }),
      setTimezone: (v) => set({ timezone: v }),
      setDateFormat: (v) => set({ dateFormat: v }),
      setCsvDelimiter: (v) => set({ csvDelimiter: v }),
      setCsvTimestampFormat: (v) => set({ csvTimestampFormat: v }),
    }),
    {
      name: "ff.ui",
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
    },
  ),
);
