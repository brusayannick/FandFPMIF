/**
 * Conformance-overlay decoration for the BPMN canvas.
 *
 * Adapted from the discovery module's frequency heatmap. Instead of colouring
 * tasks by how *often* they run, it colours them by how much they *deviate*
 * from the reference model: green = conforming, a red ramp = increasing
 * deviation, amber-dashed = a model task whose label never appears in the log
 * (the #1 conformance gotcha - a naming mismatch, not a real deviation).
 *
 * Everything is view-only: it decorates via diagram-js *markers* (CSS classes)
 * and *overlays* (floating HTML), never via `modeling.*`, so it never marks the
 * model dirty and is excluded from export.
 */

import type { PerActivityDeviation } from "./types";

export type BpmnModelerLike = { get<T = unknown>(name: string): T };

interface BElement {
  id: string;
  type: string;
  businessObject?: { name?: string; $type?: string };
}
interface ElementRegistry {
  getAll(): BElement[];
}
interface Overlays {
  add(elementId: string, type: string, opts: unknown): string;
  remove(filter: { type?: string; element?: string }): void;
}
interface Canvas {
  addMarker(id: string, cls: string): void;
  removeMarker(id: string, cls: string): void;
  scrollToElement(el: BElement | string): void;
}

/** Number of discrete red deviation buckets. Mirrored by the injected CSS. */
export const DEV_BUCKETS = 5;

export interface DeviationInfo {
  deviations: number;
  logMoves: number;
  modelMoves: number;
  matched: boolean;
}

export interface DeviationMaps {
  byActivity: Map<string, DeviationInfo>;
  maxDeviation: number;
}

export function buildDeviationMaps(
  perActivity: PerActivityDeviation[] | undefined,
): DeviationMaps {
  const byActivity = new Map<string, DeviationInfo>();
  let maxDeviation = 0;
  for (const a of perActivity ?? []) {
    byActivity.set(a.activity, {
      deviations: a.deviations,
      logMoves: a.log_moves,
      modelMoves: a.model_moves,
      matched: a.matched,
    });
    if (a.deviations > maxDeviation) maxDeviation = a.deviations;
  }
  return { byActivity, maxDeviation };
}

function isTask(el: BElement): boolean {
  return /Task$/.test(el.type) || el.type === "bpmn:SubProcess";
}
function nameOf(el: BElement | undefined): string | undefined {
  const n = el?.businessObject?.name;
  return n && n.length > 0 ? n : undefined;
}
function bucketOf(ratio: number): number {
  if (ratio <= 0) return 0;
  return Math.max(1, Math.min(DEV_BUCKETS, Math.ceil(ratio * DEV_BUCKETS)));
}

export interface ConformanceDecorOptions {
  maps: DeviationMaps;
  heatmap: boolean;
  labels: boolean;
  /** Alignments expose log/model moves separately; show them as `+L −M`. */
  alignments: boolean;
}

const DEV_CLASSES = Array.from({ length: DEV_BUCKETS }, (_, i) => `ff-conf-dev-${i + 1}`);
const STATE_CLASSES = ["ff-conf-ok", "ff-conf-unmatched"];

function clearDecoration(modeler: BpmnModelerLike): void {
  const registry = modeler.get<ElementRegistry>("elementRegistry");
  const overlays = modeler.get<Overlays>("overlays");
  const canvas = modeler.get<Canvas>("canvas");
  overlays.remove({ type: "ff-conf" });
  for (const el of registry.getAll()) {
    for (const c of DEV_CLASSES) canvas.removeMarker(el.id, c);
    for (const c of STATE_CLASSES) canvas.removeMarker(el.id, c);
  }
}

/** Re-apply the conformance overlay from scratch. Idempotent. */
export function applyConformanceOverlay(
  modeler: BpmnModelerLike,
  opts: ConformanceDecorOptions,
): void {
  const { maps, heatmap, labels, alignments } = opts;
  clearDecoration(modeler);

  const registry = modeler.get<ElementRegistry>("elementRegistry");
  const overlays = modeler.get<Overlays>("overlays");
  const canvas = modeler.get<Canvas>("canvas");

  for (const el of registry.getAll()) {
    if (!isTask(el)) continue;
    const name = nameOf(el);
    if (!name) continue;
    const info = maps.byActivity.get(name);
    if (info === undefined) continue;

    if (!info.matched) {
      if (heatmap) canvas.addMarker(el.id, "ff-conf-unmatched");
      if (labels) {
        overlays.add(el.id, "ff-conf", {
          position: { top: -10, right: 12 },
          html: `<div class="ff-conf-badge ff-conf-badge-warn" title="No matching activity in the log">no log match</div>`,
        });
      }
      continue;
    }

    if (info.deviations <= 0) {
      if (heatmap) canvas.addMarker(el.id, "ff-conf-ok");
      continue;
    }

    if (heatmap) {
      const ratio = maps.maxDeviation > 0 ? info.deviations / maps.maxDeviation : 0;
      const b = bucketOf(ratio);
      if (b > 0) canvas.addMarker(el.id, `ff-conf-dev-${b}`);
    }
    if (labels) {
      const text = alignments
        ? `+${info.logMoves} −${info.modelMoves}`
        : `${info.deviations}`;
      overlays.add(el.id, "ff-conf", {
        position: { top: -10, right: 12 },
        html: `<div class="ff-conf-badge" title="${info.deviations} deviation(s)">${text}</div>`,
      });
    }
  }
}

/** Centre an activity by (case-insensitive substring) name, with a transient
 *  highlight. Returns false when nothing matches. */
export function locateActivity(modeler: BpmnModelerLike, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  const registry = modeler.get<ElementRegistry>("elementRegistry");
  const canvas = modeler.get<Canvas>("canvas");

  let hit: BElement | undefined;
  for (const el of registry.getAll()) {
    if (!isTask(el)) continue;
    const name = nameOf(el)?.toLowerCase();
    if (name && name.includes(q)) {
      hit = el;
      break;
    }
  }
  if (!hit) return false;

  canvas.scrollToElement(hit);
  canvas.addMarker(hit.id, "ff-conf-hit");
  const id = hit.id;
  window.setTimeout(() => {
    try {
      canvas.removeMarker(id, "ff-conf-hit");
    } catch {
      /* canvas torn down before the timeout fired - ignore. */
    }
  }, 2200);
  return true;
}

const STYLE_ID = "ff-conformance-styles";

/** Map a 0..1 deviation ratio to a red fill/stroke pair. */
function devColor(ratio: number): { fill: string; stroke: string } {
  const r = Math.max(0, Math.min(1, ratio));
  const sat = 70 + r * 25; // 70% → 95%
  const fillL = 95 - r * 30; // 95% → 65% (keep dark labels readable)
  const strokeL = 55 - r * 25; // 55% → 30%
  return { fill: `hsl(0 ${sat}% ${fillL}%)`, stroke: `hsl(0 ${sat}% ${strokeL}%)` };
}

/** Idempotently inject the overlay stylesheet (the module bundler has no CSS
 *  loader, so we ship CSS as a <style> tag rather than an import). */
export function injectConformanceStyles(): void {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;

  const devRules: string[] = [];
  for (let i = 1; i <= DEV_BUCKETS; i++) {
    const { fill, stroke } = devColor(i / DEV_BUCKETS);
    devRules.push(
      `.djs-element.ff-conf-dev-${i} .djs-visual > :nth-child(1){fill:${fill}!important;stroke:${stroke}!important;}`,
    );
  }

  const css = `
.djs-element.ff-conf-ok .djs-visual > :nth-child(1){fill:hsl(151 55% 93%)!important;stroke:hsl(151 48% 40%)!important;}
.djs-element.ff-conf-unmatched .djs-visual > :nth-child(1){fill:hsl(38 92% 92%)!important;stroke:hsl(33 92% 45%)!important;stroke-dasharray:4 3!important;}
.djs-element.ff-conf-hit .djs-outline{stroke:#2563eb!important;stroke-width:3px!important;stroke-dasharray:none!important;display:block!important;}
${devRules.join("\n")}
.ff-conf-badge{font:600 10px/1.35 ui-sans-serif,system-ui,sans-serif;background:hsl(0 72% 42%);color:#fff;padding:1px 5px;border-radius:6px;white-space:nowrap;pointer-events:none;box-shadow:0 1px 2px rgba(0,0,0,.25);}
.ff-conf-badge-warn{background:hsl(33 90% 42%);}
`;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = css;
  document.head.appendChild(style);
}
