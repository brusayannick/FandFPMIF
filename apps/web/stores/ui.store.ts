"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

interface UIStore {
  sidebarCollapsed: boolean;
  isPanelOpen: boolean;
  selectedNodeId: string | null;
  activeModuleId: string | null;
  activePanelTab: "properties" | "analysis" | "history";

  toggleSidebar: () => void;
  setSidebarCollapsed: (v: boolean) => void;
  setPanelOpen: (v: boolean) => void;
  setSelectedNodeId: (id: string | null) => void;
  setActiveModuleId: (id: string | null) => void;
  setActivePanelTab: (tab: "properties" | "analysis" | "history") => void;
}

export const useUIStore = create<UIStore>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      isPanelOpen: true,
      selectedNodeId: null,
      activeModuleId: null,
      activePanelTab: "properties",

      toggleSidebar: () =>
        set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
      setPanelOpen: (v) => set({ isPanelOpen: v }),
      setSelectedNodeId: (id) => set({ selectedNodeId: id }),
      setActiveModuleId: (id) => set({ activeModuleId: id }),
      setActivePanelTab: (tab) => set({ activePanelTab: tab }),
    }),
    {
      name: "flows-funds-ui",
      partialize: (s) => ({
        sidebarCollapsed: s.sidebarCollapsed,
        isPanelOpen: s.isPanelOpen,
      }),
    },
  ),
);
