"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type ExperienceLevel = "beginner" | "intermediate" | "expert";

interface OnboardingState {
  completed: boolean;
  experienceLevel: ExperienceLevel | null;
  setExperienceLevel: (level: ExperienceLevel) => void;
  complete: () => void;
  reset: () => void;
}

export const useOnboarding = create<OnboardingState>()(
  persist(
    (set) => ({
      completed: false,
      experienceLevel: null,
      setExperienceLevel: (level) => set({ experienceLevel: level }),
      complete: () => set({ completed: true }),
      reset: () => set({ completed: false, experienceLevel: null }),
    }),
    {
      name: "ff.onboarding",
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
    },
  ),
);
