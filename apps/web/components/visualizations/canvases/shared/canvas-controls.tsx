"use client";

// Shared canvas chrome used by every canvas view – both the React Flow shell
// (`canvas-shell.tsx`) and the standalone bpmn-js viewers (discovery /
// conformance). Exposed to module bundles as a runtime external
// (`runtime-externals.json` + `module-runtime.ts`), so keep the surface small
// and dependency-light.

import { useCallback, useEffect, useRef, useState } from "react";
import { Maximize2, Minimize2 } from "lucide-react";

import { Button } from "@/components/ui/button";

// Cross-fade timings for entering/leaving pseudo-fullscreen.
const FS_ENTER_MS = 180;
const FS_EXIT_MS = 180;
// Inline props we overwrite while fullscreen (kebab-case for set/getProperty,
// which sidesteps CSSStyleDeclaration keys TS doesn't model, e.g. `inset`).
const FS_STYLE_PROPS = [
  "position",
  "inset",
  "margin",
  "width",
  "height",
  "z-index",
  "opacity",
  "transition",
] as const;

/**
 * Maximise an element to fill the platform viewport – a *pseudo*-fullscreen
 * overlay (`position: fixed; inset: 0`), NOT the browser Fullscreen API. Keeps
 * the browser chrome (tabs, URL bar) in place and just expands the canvas over
 * the app shell, so there's no OS-level fullscreen jump / black letterboxing.
 *
 * Enter fades the overlay in over the app. Exit fades a throwaway *clone* of the
 * fullscreen view out while the real element is restored into its card slot
 * underneath – one node can't be both the fading overlay and the revealed card,
 * so fading the element itself would flash the empty slot and pop the card back.
 * A hidden placeholder holds the slot in normal flow (no sibling reflow), and
 * `isFullscreen` flips to `false` as the card is restored so consumers re-fit
 * against the card size, not the viewport (the clone hides that reflow).
 * `prefers-reduced-motion` collapses both to an instant toggle. Esc exits.
 * SSR-guarded. Generic over the element type so a `useRef<HTMLDivElement>(null)`
 * passes without a cast.
 */
export function useFullscreen<T extends HTMLElement>(
  ref: React.RefObject<T | null>,
): { isFullscreen: boolean; toggle: () => void } {
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Inline styles captured on enter; replayed to restore the element on exit.
  const savedRef = useRef<Record<string, string> | null>(null);
  // Flow-slot placeholder kept in the DOM while fullscreen (removed on exit).
  const placeholderRef = useRef<HTMLDivElement | null>(null);
  // Throwaway fullscreen clone faded out on exit (see EXIT below).
  const cloneRef = useRef<HTMLElement | null>(null);
  // Blocks re-entrant toggles (double-click / Esc) mid-animation.
  const busyRef = useRef(false);

  const toggle = useCallback(() => {
    if (typeof document === "undefined") return;
    const el = ref.current;
    if (!el || busyRef.current) return;

    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const restore = () => {
      const s = savedRef.current;
      if (!s) return;
      for (const p of FS_STYLE_PROPS) el.style.setProperty(p, s[p]);
      savedRef.current = null;
    };

    // ---------- ENTER ----------
    if (!isFullscreen) {
      const card = el.getBoundingClientRect();

      const snap: Record<string, string> = {};
      for (const p of FS_STYLE_PROPS) snap[p] = el.style.getPropertyValue(p);
      savedRef.current = snap;

      // Placeholder holds the card's slot so nothing else reflows.
      const ph = document.createElement("div");
      ph.style.width = `${card.width}px`;
      ph.style.height = `${card.height}px`;
      ph.style.flex = "none";
      ph.style.visibility = "hidden";
      ph.setAttribute("aria-hidden", "true");
      el.parentNode?.insertBefore(ph, el);
      placeholderRef.current = ph;

      // Fill the viewport above the app shell.
      el.style.setProperty("position", "fixed");
      el.style.setProperty("inset", "0");
      el.style.setProperty("margin", "0");
      el.style.setProperty("width", "100%");
      el.style.setProperty("height", "100%");
      el.style.setProperty("z-index", "50");

      // Report fullscreen now: the element is already viewport-sized, so a
      // consumer re-fit (keyed on this flag) frames the graph at full size.
      setIsFullscreen(true);
      if (reduce) return;

      // Fade in over the app.
      busyRef.current = true;
      el.style.setProperty("transition", "none");
      el.style.setProperty("opacity", "0");
      void el.offsetHeight; // commit the start frame
      el.style.setProperty("transition", `opacity ${FS_ENTER_MS}ms ease-out`);
      el.style.setProperty("opacity", "1");
      const onEnd = (e: TransitionEvent) => {
        if (e.target !== el || e.propertyName !== "opacity") return;
        el.removeEventListener("transitionend", onEnd);
        el.style.setProperty("transition", "");
        el.style.setProperty("opacity", "");
        busyRef.current = false;
      };
      el.addEventListener("transitionend", onEnd);
      return;
    }

    // ---------- EXIT ----------
    // The fullscreen node and its card slot are the *same* element, so fading
    // the element out would just reveal the empty placeholder slot and then pop
    // the card back in. Instead, fade a throwaway clone of the current
    // fullscreen view out while restoring the real element into its slot
    // immediately underneath it (already re-fit, no hole, no pop).
    const ph = placeholderRef.current;
    const teardown = () => {
      ph?.parentNode?.removeChild(ph);
      placeholderRef.current = null;
      restore(); // element returns to the card box, in flow, where the slot was
      setIsFullscreen(false); // now consumers re-fit against the card size
    };

    if (reduce) {
      teardown();
      busyRef.current = false;
      return;
    }

    busyRef.current = true;
    // Snapshot the live fullscreen view (SVG/HTML subtrees clone visually).
    const clone = el.cloneNode(true) as HTMLElement;
    for (const [p, v] of [
      ["position", "fixed"],
      ["inset", "0"],
      ["margin", "0"],
      ["width", "100%"],
      ["height", "100%"],
      ["z-index", "50"],
      ["opacity", "1"],
      ["transition", "none"],
      ["pointer-events", "none"],
    ] as const) {
      clone.style.setProperty(p, v);
    }
    clone.setAttribute("aria-hidden", "true");
    document.body.appendChild(clone);
    cloneRef.current = clone;

    // Reveal the restored card beneath the still-opaque clone, then fade it out.
    teardown();
    void clone.offsetHeight;
    clone.style.setProperty("transition", `opacity ${FS_EXIT_MS}ms ease-in`);
    clone.style.setProperty("opacity", "0");

    let done = false;
    const settle = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clone.removeEventListener("transitionend", onEnd);
      clone.parentNode?.removeChild(clone);
      cloneRef.current = null;
      busyRef.current = false;
    };
    const onEnd = (e: TransitionEvent) => {
      if (e.target !== clone || e.propertyName !== "opacity") return;
      settle();
    };
    clone.addEventListener("transitionend", onEnd);
    // Fallback if transitionend is dropped (tab hidden mid-anim, etc.).
    const timer = setTimeout(settle, FS_EXIT_MS + 120);
  }, [isFullscreen, ref]);

  // Esc exits while fullscreen.
  useEffect(() => {
    if (!isFullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") toggle();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isFullscreen, toggle]);

  // Drop a stray placeholder / exit-clone if the canvas unmounts mid-animation.
  useEffect(
    () => () => {
      placeholderRef.current?.parentNode?.removeChild(placeholderRef.current);
      cloneRef.current?.parentNode?.removeChild(cloneRef.current);
    },
    [],
  );

  return { isFullscreen, toggle };
}

/** Ghost icon button matching the canvas-shell toolbar, toggling fullscreen. */
export function CanvasFullscreenButton({
  isFullscreen,
  onToggle,
}: {
  isFullscreen: boolean;
  onToggle: () => void;
}) {
  const Icon = isFullscreen ? Minimize2 : Maximize2;
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7 cursor-pointer"
      onClick={onToggle}
      aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
      title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
    >
      <Icon className="h-3.5 w-3.5" />
    </Button>
  );
}

/**
 * Show-on-interaction visibility gate for canvas chrome (the minimap).
 *
 * `notifyActivity()` flips `visible` true and (re)arms a timer that flips it
 * back to false after `idleMs` of no further activity. Callers pump
 * `notifyActivity` from pan/zoom/drag/wheel/pointer signals; consumers fade the
 * element on `visible`.
 */
export function useCanvasIdleVisibility({ idleMs = 1200 }: { idleMs?: number } = {}): {
  visible: boolean;
  notifyActivity: () => void;
} {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notifyActivity = useCallback(() => {
    setVisible(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setVisible(false), idleMs);
  }, [idleMs]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  return { visible, notifyActivity };
}

/** Minimal structural view of the diagram-js `canvas` service we need here. */
type BpmnCanvasLike = { zoom: (scale?: number | string, center?: string) => number };

/**
 * Fit a bpmn-js diagram into its viewport, centred on **both** axes with even
 * breathing room on every side.
 *
 * diagram-js's own `zoom("fit-viewport")` (a) pins the diagram top-left unless a
 * center reference is passed and (b) has no padding knob, so it fits edge-to-edge.
 * We fix both: `"auto"` centres the fit, then a second zoom shrinks around the
 * (now centred) viewport midpoint to inset the content. `margin` is the fraction
 * of the viewport left blank per side (0.05 ⇒ ~5% each side).
 */
export function fitBpmnViewport(canvas: BpmnCanvasLike, margin = 0.05): void {
  canvas.zoom("fit-viewport", "auto");
  canvas.zoom(canvas.zoom() * (1 - 2 * margin), "auto");
}
