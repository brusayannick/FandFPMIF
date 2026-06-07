"use client";

// bpmn-js / diagram-js-minimap CSS is loaded by the host app (apps/web)
// rather than imported here — the module bundler (esbuild) has no loaders
// for the .woff/.ttf/.eot/.svg font assets the BPMN font CSS references.
// See apps/web/app/layout.tsx for the actual imports.

import { useEffect, useRef, useState } from "react";
import { Maximize, Minus, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/format";

// Static imports — these specifiers are listed in
// apps/web/lib/runtime-externals.json, so the module bundler leaves them as
// `require()` calls that the host's __FF_RUNTIME__ shim resolves to the
// single bpmn-js instance shared across modules. Don't switch these to
// `import("...")`: the bundler matches externals against static specifiers,
// and a dynamic import would get inlined into the panel bundle.
import BpmnModeler from "bpmn-js/lib/Modeler";
import minimapModule from "diagram-js-minimap";
import { layoutProcess } from "bpmn-auto-layout";

import {
  applyBpmnOverlay,
  injectBpmnStyles,
  locateActivity,
  type BpmnModelerLike,
  type FrequencyMaps,
} from "../bpmn-decorate";

// pm4py emits BPMN XML without BPMNDI (no coordinates). bpmn-auto-layout
// idempotently fills them in. Hand-authored / Camunda files already have DI
// and pass through unchanged.
async function ensureLayout(xml: string): Promise<string> {
  try {
    return await layoutProcess(xml);
  } catch {
    return xml;
  }
}

export interface BpmnDecor {
  heatmap: boolean;
  freqLabels: boolean;
  dimRare: boolean;
  dimLevel: number;
}

export interface BpmnCanvasProps {
  /** Initial BPMN XML. Updates after mount are ignored — re-mount the
   *  component via a `key` prop to swap models. */
  xml: string;
  /** Fired whenever the user mutates the diagram. Receives the latest XML. */
  onChange?: (xml: string) => void;
  /** Optional fired-once callback with the modeler instance, for callers
   *  that need to drive imperative actions (e.g. fit-viewport, export). */
  onReady?: (modeler: unknown) => void;
  /** DFG-derived frequency maps driving the heatmap / badges. */
  freq?: FrequencyMaps;
  /** Frequency-overlay display toggles. */
  decor?: BpmnDecor;
  /** Read-only mode — hides palette/context-pad, blocks edits, keeps pan/zoom. */
  locked?: boolean;
  /** Activity search term; centred + highlighted whenever `searchNonce` bumps. */
  searchQuery?: string;
  searchNonce?: number;
  /** Reports whether the last search located an activity. */
  onSearchResult?: (found: boolean) => void;
}

type ModelerHandle = BpmnModelerLike & {
  destroy: () => void;
  saveXML: (opts: { format: boolean }) => Promise<{ xml?: string }>;
  importXML: (xml: string) => Promise<unknown>;
  on: (event: string, cb: () => void) => void;
};

const DEFAULT_DECOR: BpmnDecor = {
  heatmap: true,
  freqLabels: true,
  dimRare: false,
  dimLevel: 0.15,
};

export function BpmnCanvas({
  xml,
  onChange,
  onReady,
  freq,
  decor,
  locked = true,
  searchQuery,
  searchNonce,
  onSearchResult,
}: BpmnCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const modelerRef = useRef<ModelerHandle | null>(null);
  const [ready, setReady] = useState(false);
  // Capture handlers in refs so the mount effect can stay [] without
  // re-creating the modeler when the parent's callback identities change.
  const onChangeRef = useRef(onChange);
  const onReadyRef = useRef(onReady);
  const onSearchResultRef = useRef(onSearchResult);
  onChangeRef.current = onChange;
  onReadyRef.current = onReady;
  onSearchResultRef.current = onSearchResult;

  useEffect(() => {
    injectBpmnStyles();
    const container = containerRef.current;
    if (!container) return;

    let modeler: ModelerHandle | null = null;
    let cancelled = false;

    (async () => {
      modeler = new BpmnModeler({
        container,
        additionalModules: [minimapModule],
      }) as unknown as ModelerHandle;

      try {
        const laidOut = await ensureLayout(xml);
        if (cancelled || !modeler) return;
        await modeler.importXML(laidOut);
        const canvas = modeler.get<{ zoom: (mode: string) => void }>("canvas");
        canvas.zoom("fit-viewport");
        try {
          modeler.get<{ open: () => void }>("minimap").open();
        } catch {
          // minimap module already initialised in some other state — ignore.
        }
      } catch (err) {
        console.error("BpmnCanvas: importXML failed", err);
        return;
      }

      modelerRef.current = modeler;
      setReady(true);
      onReadyRef.current?.(modeler);

      // commandStack.changed fires for create / move / delete / property
      // edits. Save the resulting XML so the parent can persist on demand.
      // Decoration uses markers/overlays only, so it never lands here.
      modeler.on("commandStack.changed", () => {
        if (!modeler) return;
        modeler
          .saveXML({ format: true })
          .then(({ xml: out }) => {
            if (out !== undefined) onChangeRef.current?.(out);
          })
          .catch((err) => console.error("BpmnCanvas: saveXML failed", err));
      });
    })();

    return () => {
      cancelled = true;
      modelerRef.current = null;
      setReady(false);
      try {
        modeler?.destroy();
      } catch {
        /* ignore — destroy can throw if import never completed */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-apply the frequency overlay whenever the data or toggles change.
  useEffect(() => {
    const modeler = modelerRef.current;
    if (!ready || !modeler || !freq) return;
    const d = decor ?? DEFAULT_DECOR;
    try {
      applyBpmnOverlay(modeler, {
        freq,
        heatmap: d.heatmap,
        freqLabels: d.freqLabels,
        dimRare: d.dimRare,
        dimLevel: d.dimLevel,
        formatNumber,
      });
    } catch (err) {
      console.error("BpmnCanvas: applyBpmnOverlay failed", err);
    }
  }, [ready, freq, decor]);

  // Toggle read-only mode.
  useEffect(() => {
    const modeler = modelerRef.current;
    const container = containerRef.current;
    if (!ready || !modeler || !container) return;
    container.classList.toggle("ff-bpmn-locked", locked);
    try {
      const keyboard = modeler.get<{ bind: (n: Document) => void; unbind: () => void }>(
        "keyboard",
      );
      if (locked) keyboard.unbind();
      else keyboard.bind(document);
    } catch {
      // keyboard module not present — palette hiding alone is enough.
    }
  }, [ready, locked]);

  // Locate an activity on demand.
  useEffect(() => {
    const modeler = modelerRef.current;
    if (!ready || !modeler || !searchNonce || !searchQuery) return;
    const found = locateActivity(modeler, searchQuery);
    onSearchResultRef.current?.(found);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchNonce]);

  const zoomBy = (factor: number) => {
    const modeler = modelerRef.current;
    if (!modeler) return;
    const canvas = modeler.get<{ zoom: (m?: number | string) => number }>("canvas");
    const current = canvas.zoom();
    canvas.zoom(typeof current === "number" ? current * factor : "fit-viewport");
  };
  const fit = () => modelerRef.current?.get<{ zoom: (m: string) => void }>("canvas").zoom("fit-viewport");

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      <div className="absolute bottom-3 right-3 z-10 flex flex-col gap-1 rounded-md border bg-card/90 p-1 shadow-sm backdrop-blur">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => zoomBy(1.2)} title="Zoom in">
          <Plus className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => zoomBy(1 / 1.2)} title="Zoom out">
          <Minus className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={fit} title="Fit to view">
          <Maximize className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
