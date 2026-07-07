"use client";

import { create } from "zustand";

/**
 * Run state for the interactive product tour (the live, end-to-end spotlight
 * walkthrough of process discovery). Completion is persisted server-side via
 * the `onboarding` UserSetting (`tour_completed`); this store only holds the
 * ephemeral run state so any component can launch/drive it (`TourOverlay`
 * renders it, Settings → About starts it, the wizard auto-chains into it).
 */
interface TourState {
  active: boolean;
  stepIndex: number;
  /** True when auto-launched right after the setup wizard (vs. a manual replay).
   *  Informational – lets the overlay tune copy/behaviour if needed. */
  auto: boolean;
  start: (opts?: { auto?: boolean }) => void;
  next: () => void;
  prev: () => void;
  goTo: (i: number) => void;
  stop: () => void;
}

export const useTour = create<TourState>((set) => ({
  active: false,
  stepIndex: 0,
  auto: false,
  start: (opts) => set({ active: true, stepIndex: 0, auto: opts?.auto ?? false }),
  next: () => set((s) => ({ stepIndex: s.stepIndex + 1 })),
  prev: () => set((s) => ({ stepIndex: Math.max(0, s.stepIndex - 1) })),
  goTo: (i) => set({ stepIndex: Math.max(0, i) }),
  stop: () => set({ active: false, stepIndex: 0, auto: false }),
}));
