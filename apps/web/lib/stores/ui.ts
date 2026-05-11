"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

interface UiState {
  sidebarCollapsed: boolean;
  showUnavailableModules: boolean;
  showDisabledModules: boolean;
  notificationsMuted: boolean;
  atlasOpen: boolean;
  toggleSidebar: () => void;
  setShowUnavailableModules: (v: boolean) => void;
  setShowDisabledModules: (v: boolean) => void;
  setNotificationsMuted: (v: boolean) => void;
  toggleAtlas: () => void;
  setAtlasOpen: (v: boolean) => void;
}

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      showUnavailableModules: true,
      showDisabledModules: false,
      notificationsMuted: false,
      atlasOpen: false,
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setShowUnavailableModules: (v) => set({ showUnavailableModules: v }),
      setShowDisabledModules: (v) => set({ showDisabledModules: v }),
      setNotificationsMuted: (v) => set({ notificationsMuted: v }),
      toggleAtlas: () => set((s) => ({ atlasOpen: !s.atlasOpen })),
      setAtlasOpen: (v) => set({ atlasOpen: v }),
    }),
    {
      name: "ff.ui",
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
    },
  ),
);
