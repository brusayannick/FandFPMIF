"use client";

import { InfoHint } from "./info-hint";

/**
 * Plain-language hover explanations for every metric this module surfaces
 * (panel tables, header badges, transition heatmap, dashboard widgets).
 *
 * Grounded in the papers under `papers/`:
 * - Augusto et al. (2022), "The connection between process complexity of
 *   event sequences and models discovered by process mining",
 *   Information Sciences 598 — §3.2 (the four EPA entropy measures).
 * - Langer (2025), "Understanding Business Process Complexity" (WWU master
 *   thesis) — §2.4.3–2.4.6 + Table 3.3 (all other measures).
 *
 * Keys match `METRIC_DEFS` in `metrics_core.py` (plus `prob_act_pairs` for
 * the heatmap). A metric without an entry renders no hint.
 */

const AUGUSTO = "Augusto et al., 2022";
const LANGER = "Langer, 2025";

export interface MetricInfo {
  title: string;
  text: string;
  /** Paper (in `papers/`) the explanation is grounded in. */
  source: string;
}

export const METRIC_INFO: Record<string, MetricInfo> = {
  // ── Entropy ────────────────────────────────────────────────────────────────
  var_e: {
    title: "Variant Entropy",
    text:
      "Graph entropy of the log's Extended Prefix Automaton (EPA), where traces sharing a prefix share states: |S|·log|S| minus the sum of |partition|·log|partition| over the automaton's state partitions. It measures how much the recorded behavior branches, considering only the structure — not how often each path is taken.",
    source: AUGUSTO,
  },
  seq_e: {
    title: "Sequence Entropy",
    text:
      "The same EPA graph entropy as variant entropy, but each partition is weighted by the number of events it contains instead of the number of states. It therefore also reflects how frequently each prefix actually occurs, and grows monotonically as events are added.",
    source: AUGUSTO,
  },
  nvar_e: {
    title: "Normalized Variant Entropy",
    text:
      "Variant entropy divided by its theoretical maximum |S|·log|S|, scaling it to [0,1] so logs whose automata differ in size can be compared.",
    source: AUGUSTO,
  },
  nseq_e: {
    title: "Normalized Sequence Entropy",
    text:
      "Sequence entropy divided by its theoretical maximum |seq(S)|·log|seq(S)|, scaling it to [0,1] for comparison across logs of different sizes.",
    source: AUGUSTO,
  },
  // ── Enriched entropy ──────────────────────────────────────────────────────
  en_var_e: {
    title: "Enriched Variant Entropy",
    text:
      "Variant entropy over an Enriched EPA (EEPA) whose states also key on the IEEE-XES event/trace attributes, so otherwise identical activity sequences with different event data count as distinct behavior. Integrates data variety into complexity, as proposed by Vidgof & Mendling (2023).",
    source: LANGER,
  },
  en_seq_e: {
    title: "Enriched Sequence Entropy",
    text:
      "Sequence entropy over the Enriched EPA: the event-frequency-weighted graph entropy, where events with differing attribute data split into distinct states even when the activity sequence is identical (Vidgof & Mendling, 2023).",
    source: LANGER,
  },
  en_nvar_e: {
    title: "Enriched Normalized Variant Entropy",
    text:
      "Enriched variant entropy scaled to [0,1] by its theoretical maximum — computed like the normalized variant entropy, but on the attribute-aware EEPA (Vidgof & Mendling, 2023).",
    source: LANGER,
  },
  en_nseq_e: {
    title: "Enriched Normalized Sequence Entropy",
    text:
      "Enriched sequence entropy scaled to [0,1] by its theoretical maximum — computed like the normalized sequence entropy, but on the attribute-aware EEPA (Vidgof & Mendling, 2023).",
    source: LANGER,
  },
  // ── Size ──────────────────────────────────────────────────────────────────
  n_events: {
    title: "Number of Events",
    text:
      "Total count of events across all traces — introduced by Günther (2009) as the magnitude of an event log. A pure size measure: more recorded events make a larger, potentially more complex log.",
    source: LANGER,
  },
  n_event_types: {
    title: "Number of Event Types",
    text:
      "Number of unique event types (activities) across all events and traces — Günther's (2009) variety. More distinct activities mean more behavior the process can exhibit.",
    source: LANGER,
  },
  n_sequences: {
    title: "Number of Sequences",
    text:
      "Total number of traces (cases) in the log — Günther's (2009) support. A basic size measure counting recorded process executions.",
    source: LANGER,
  },
  min_seq_len: {
    title: "Minimum Sequence Length",
    text:
      "Number of events in the shortest trace (van der Aalst, 2016) — a basic size measure derived from the event-log structure.",
    source: LANGER,
  },
  avg_seq_len: {
    title: "Average Sequence Length",
    text: "Mean number of events per trace (van der Aalst, 2016).",
    source: LANGER,
  },
  max_seq_len: {
    title: "Maximum Sequence Length",
    text: "Number of events in the longest trace (van der Aalst, 2016).",
    source: LANGER,
  },
  avg_td_e: {
    title: "Avg. Time Difference between Consecutive Events",
    text:
      "Mean time gap between consecutive events within a trace, averaged across all traces. Builds on Günther's (2009) time granularity, but uses the mean instead of the smallest gap — capturing how densely the process is recorded in time.",
    source: LANGER,
  },
  // ── Variation ─────────────────────────────────────────────────────────────
  n_acyclic_paths: {
    title: "Number of Acyclic Paths",
    text:
      "Approximates how many different acyclic paths the log's directly-follows transition matrix implies, via 10^(0.08·(1+e−v)) with e = distinct directly-follows edges and v = distinct event types (Hærem et al., 2015). More possible routes through the process mean more variation.",
    source: LANGER,
  },
  n_ties: {
    title: "Number of Ties",
    text:
      "Ties in the network representation of the process: the sum, across all trace variants, of the paths from the root of the trace graph to each of its end nodes (Hærem et al., 2015).",
    source: LANGER,
  },
  lempel_ziv: {
    title: "Lempel-Ziv Complexity",
    text:
      "Number of distinct sub-sequences (LZ76 phrases) needed to describe the event stream without repetition (Pentland, 2003). Repetitive behavior compresses into few phrases; random-looking behavior needs many.",
    source: LANGER,
  },
  n_unique_seq: {
    title: "Number of Unique Sequences",
    text:
      "Count of unique traces — activity sequences not repeated by any other case (van der Aalst, 2016). An intuitive measure of variation across traces.",
    source: LANGER,
  },
  perc_unique_seq: {
    title: "Percentage of Unique Sequences",
    text:
      "Unique traces divided by the total number of traces (van der Aalst, 2016). 100% means every case followed its own distinct path.",
    source: LANGER,
  },
  avg_distinct_e: {
    title: "Avg. Distinct Events per Sequence",
    text:
      "Counts the distinct event types within each trace and averages that over all traces (Günther, 2009). High values mean individual cases touch many different activities.",
    source: LANGER,
  },
  order_var: {
    title: "Order Variation",
    text:
      "Total number of transitions between event types divided by the total number of events (Lindberg et al., 2016) — variation in how event types are sequenced within traces.",
    source: LANGER,
  },
  activity_var: {
    title: "Activity Variation",
    text:
      "Shannon entropy over the relative occurrence shares of all event types in the log (Lindberg et al., 2016). Maximal when every activity occurs equally often; low when a few dominate.",
    source: LANGER,
  },
  // ── Distance ──────────────────────────────────────────────────────────────
  affinity: {
    title: "Average Affinity",
    text:
      "Similarity of the directly-follows transitions between unique traces, computed for all pairs and normalized over the unique traces (Günther, 2009). Homogeneous logs — traces sharing the same orderings — score high, signaling lower complexity.",
    source: LANGER,
  },
  structure: {
    title: "Structure",
    text:
      "Observed directly-follows transitions between event types divided by the maximum possible number, inverted (Günther, 2009). Near 1 the behavior is sparse and structured; near 0 almost any activity can follow any other.",
    source: LANGER,
  },
  dev_random: {
    title: "Deviation from Random",
    text:
      "How much the observed transition matrix differs from fully random behavior: squared deviations from the equally-distributed baseline, aggregated and normalized (Pentland, 2003).",
    source: LANGER,
  },
  avg_edit_distance: {
    title: "Average Edit Distance",
    text:
      "Mean pairwise Levenshtein distance between all traces (Pentland, 2003): the average number of edits needed to turn one trace's activity sequence into another's. Larger values mean cases differ more.",
    source: LANGER,
  },
  structural_var: {
    title: "Structural Process Variety",
    text:
      "Builds the pairwise Levenshtein distance matrix over traces, applies agglomerative hierarchical clustering to it, and sums the distances between the resulting clusters — the merge heights (Schreiber & Abbad-Andaloussi, 2024).",
    source: LANGER,
  },
  // ── Heatmap (not a scalar metric) ─────────────────────────────────────────
  prob_act_pairs: {
    title: "Probability of Action Pairs",
    text:
      "Transition-probability matrix over all event types (Grisold et al., 2022): the number of directly-follows transitions from one event type to another, divided by all transitions out of the source type. Suited to qualitative reading of how event transitions shift, rather than to a single score.",
    source: LANGER,
  },
};

/** ⓘ hint for a metric key; renders nothing when no explanation is mapped. */
export function MetricInfoHint({
  metricKey,
  className,
}: {
  metricKey: string;
  className?: string;
}) {
  const info = METRIC_INFO[metricKey];
  if (!info) return null;
  return (
    <InfoHint label={`What does ${info.title} mean?`} className={className}>
      <p>{info.text}</p>
      <p className="text-muted-foreground">Source: {info.source}</p>
    </InfoHint>
  );
}
