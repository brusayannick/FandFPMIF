"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type Density = "comfortable" | "compact";

interface UiState {
  density: Density;
  sidebarCollapsed: boolean;
  showUnavailableModules: boolean;
  showDisabledModules: boolean;
  notificationsMuted: boolean;
  setDensity: (d: Density) => void;
  toggleSidebar: () => void;
  setShowUnavailableModules: (v: boolean) => void;
  setShowDisabledModules: (v: boolean) => void;
  setNotificationsMuted: (v: boolean) => void;
}

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      density: "comfortable",
      sidebarCollapsed: false,
      showUnavailableModules: true,
      showDisabledModules: false,
      notificationsMuted: false,
      setDensity: (density) => set({ density }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setShowUnavailableModules: (v) => set({ showUnavailableModules: v }),
      setShowDisabledModules: (v) => set({ showDisabledModules: v }),
      setNotificationsMuted: (v) => set({ notificationsMuted: v }),
    }),
    {
      name: "ff.ui",
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
    },
  ),
);
