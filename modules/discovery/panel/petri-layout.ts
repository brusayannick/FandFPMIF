"use client";

import { create } from "zustand";

import type { LayoutDirection } from "@/lib/stores/visualization-settings";

interface PetriLayoutState {
  direction: LayoutDirection;
  setDirection: (d: LayoutDirection) => void;
}

/**
 * Petri-scoped layout direction.
 *
 * The shared `general.layoutDirection` defaults to TB and is still used by the
 * Heuristics net (the DFG ignores it entirely – it ships the fixed Celonis
 * flow). The Petri net reads its direction from here instead so it can default
 * to LR – the natural left→right reading order for places/transitions – without
 * flipping any other view. `place-node`/`transition-node` (both Petri-only)
 * anchor their handles off the same value, and `PetriNetCanvas` re-runs its ELK
 * layout whenever it changes, so the toggle re-lays the net out live.
 */
export const usePetriLayout = create<PetriLayoutState>()((set) => ({
  direction: "LR",
  setDirection: (direction) => set({ direction }),
}));
