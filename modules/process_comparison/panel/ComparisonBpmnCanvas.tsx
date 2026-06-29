"use client";

// bpmn-js CSS is loaded by the host app (apps/web), not imported here - the
// module bundler (esbuild) has no loaders for the font assets the BPMN font CSS
// references. See apps/web/app/layout.tsx.

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Maximize, Minus, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";

// bpmn-js / bpmn-auto-layout are bundled straight into this panel - intentionally
// NOT in runtime-externals.json. The host runs `next dev --turbo`, and Turbopack
// mis-bundles bpmn-moddle so its parser stops recognising the `bpmn:Definitions`
// root ("failed to parse document as <bpmn:Definitions>"); esbuild (this panel's
// bundler) handles it correctly. The discovery + conformance modules bundle them
// the same way. Do NOT re-externalise to "share" the host instance.
//
// NavigatedViewer is the strictly view-only bpmn-js entry: pan + scroll-zoom.
import NavigatedViewer from "bpmn-js/lib/NavigatedViewer";
import { layoutProcess } from "bpmn-auto-layout";

import {
  applyComparisonOverlay,
  injectComparisonStyles,
  type ActivityMap,
  type BpmnModelerLike,
} from "./comparison-decorate";

// pm4py BPMN has no BPMNDI (coordinates). bpmn-auto-layout idempotently fills
// them in; files that already have DI pass through unchanged.
async function ensureLayout(xml: string): Promise<string> {
  try {
    return await layoutProcess(xml);
  } catch {
    return xml;
  }
}

export interface ComparisonDecor {
  heatmap: boolean;
  labels: boolean;
}

export interface ComparisonBpmnCanvasProps {
  /** Initial BPMN XML. Updates after mount are ignored - re-mount via a `key`. */
  xml: string;
  map?: ActivityMap;
  decor?: ComparisonDecor;
}

type ModelerHandle = BpmnModelerLike & {
  destroy: () => void;
  importXML: (xml: string) => Promise<unknown>;
};

const DEFAULT_DECOR: ComparisonDecor = { heatmap: true, labels: true };

export function ComparisonBpmnCanvas({ xml, map, decor }: ComparisonBpmnCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const modelerRef = useRef<ModelerHandle | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    injectComparisonStyles();
    const container = containerRef.current;
    if (!container) return;

    let modeler: ModelerHandle | null = null;
    let cancelled = false;

    (async () => {
      modeler = new NavigatedViewer({ container }) as unknown as ModelerHandle;
      try {
        const laidOut = await ensureLayout(xml);
        if (cancelled || !modeler) return;
        await modeler.importXML(laidOut);
        const canvas = modeler.get<{ zoom: (mode: string) => void }>("canvas");
        canvas.zoom("fit-viewport");
      } catch (err) {
        console.error("ComparisonBpmnCanvas: importXML failed", err);
        if (!cancelled) setError((err as Error)?.message ?? "Failed to render BPMN");
        return;
      }
      modelerRef.current = modeler;
      setReady(true);
    })();

    return () => {
      cancelled = true;
      modelerRef.current = null;
      setReady(false);
      try {
        modeler?.destroy();
      } catch {
        /* ignore - destroy can throw if import never completed */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-apply the comparison overlay whenever the data or toggles change.
  useEffect(() => {
    const modeler = modelerRef.current;
    if (!ready || !modeler || !map) return;
    const d = decor ?? DEFAULT_DECOR;
    try {
      applyComparisonOverlay(modeler, { map, heatmap: d.heatmap, labels: d.labels });
    } catch (err) {
      console.error("ComparisonBpmnCanvas: applyComparisonOverlay failed", err);
    }
  }, [ready, map, decor]);

  const zoomBy = (factor: number) => {
    const modeler = modelerRef.current;
    if (!modeler) return;
    const canvas = modeler.get<{ zoom: (m?: number | string) => number }>("canvas");
    const current = canvas.zoom();
    canvas.zoom(typeof current === "number" ? current * factor : "fit-viewport");
  };
  const fit = () =>
    modelerRef.current?.get<{ zoom: (m: string) => void }>("canvas").zoom("fit-viewport");

  if (error) {
    return <EmptyState icon={AlertTriangle} title="Could not render BPMN" description={error} />;
  }

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      <div className="absolute bottom-3 right-3 z-10 flex flex-col gap-1 rounded-md border bg-card/90 p-1 shadow-sm backdrop-blur">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => zoomBy(1.2)}
          title="Zoom in"
        >
          <Plus className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => zoomBy(1 / 1.2)}
          title="Zoom out"
        >
          <Minus className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={fit} title="Fit to view">
          <Maximize className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
