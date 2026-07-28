"use client";

import { useCallback, useMemo, useState } from "react";
import { useProgressRouter } from "@/lib/use-progress-router";
import {
  CheckCircle2,
  ExternalLink,
  FileText,
  FileUp,
  Loader2,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { toastError } from "@/lib/toast";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useImportEventLog,
  useProbeJson,
  useProbeXml,
  type JsonProbeResponse,
  type XmlProbeResponse,
} from "@/lib/queries";
import { useAiConfig } from "@/lib/ai-queries";
import { useImportColumnMapping } from "@/lib/ai-guidance";
import { useUi } from "@/lib/stores/ui";
import { useTrack } from "@/lib/analytics/hooks";
import { EV } from "@/lib/analytics/events";
import { cn } from "@/lib/cn";

type DetectedFormat = "xes" | "xes.gz" | "csv" | "xml" | "json" | "ocel" | "zip" | "unsupported";

const COMPRESSION_SUFFIX_RE = /\.(gz|gzip|bz2|xz|lzma|zip)$/;

/** "log.csv.gz" → "log.csv"; "log.csv" unchanged. */
function stripCompression(lower: string): { inner: string; zip: boolean } {
  const m = lower.match(COMPRESSION_SUFFIX_RE);
  if (!m) return { inner: lower, zip: false };
  return { inner: lower.slice(0, -m[0].length), zip: m[1] === "zip" };
}

function isCompressed(file: File): boolean {
  return COMPRESSION_SUFFIX_RE.test(file.name.toLowerCase());
}

function detect(file: File): DetectedFormat {
  const n = file.name.toLowerCase();
  if (n.endsWith(".xes.gz")) return "xes.gz";
  const { inner, zip } = stripCompression(n);
  if (inner.endsWith(".xes")) return "xes";
  if (inner.endsWith(".csv")) return "csv";
  if (inner.endsWith(".jsonocel") || inner.endsWith(".xmlocel") || inner.endsWith(".sqlite"))
    return "ocel";
  // Plain .xml / .json are ambiguous (case-centric vs OCEL); the server sniffs
  // the content and auto-routes. We probe them client-side only to decide
  // whether to show the mapping wizard (compressed ones probe fine - the
  // server decompresses).
  if (inner.endsWith(".xml")) return "xml";
  if (inner.endsWith(".json")) return "json";
  // A bare data.zip: the server resolves the archive's single member.
  if (zip) return "zip";
  return "unsupported";
}

async function readFirstLine(file: File): Promise<string> {
  // Read up to 4KB – far more than we need for headers, less than what would
  // hurt to slurp synchronously into memory.
  const blob = file.slice(0, 4096);
  const text = await blob.text();
  return text.split(/\r?\n/, 1)[0] ?? "";
}

async function readSampleLines(file: File, lineCount: number): Promise<string[]> {
  // Read a 32 KB prefix so we get enough rows even on wide schemas.
  const blob = file.slice(0, 32 * 1024);
  const text = await blob.text();
  return text.split(/\r?\n/).filter((l) => l.length > 0).slice(0, lineCount);
}

function parseCsvHeader(line: string, delimiter: string): string[] {
  // Minimal split – quoted commas in headers are vanishingly rare; the
  // backend revalidates on import and the wizard is otherwise advisory.
  return line.split(delimiter).map((c) => c.replace(/^"(.*)"$/, "$1").trim());
}

interface CsvMapping {
  case_id: string;
  activity: string;
  timestamp: string;
  end_timestamp?: string;
  resource?: string;
  cost?: string;
  delimiter: string;
  timestamp_format?: string;
}

interface XmlMapping {
  event_element: string;
  case_id: string;
  activity: string;
  timestamp: string;
  end_timestamp?: string;
  resource?: string;
  cost?: string;
  timestamp_format?: string;
}

type XmlMappingFieldKey =
  | "case_id"
  | "activity"
  | "timestamp"
  | "end_timestamp"
  | "resource"
  | "cost";

interface JsonMapping {
  event_path?: string;
  case_id: string;
  activity: string;
  timestamp: string;
  end_timestamp?: string;
  resource?: string;
  cost?: string;
  timestamp_format?: string;
}

type JsonMappingFieldKey = XmlMappingFieldKey;

// Each canonical field has an ordered list of candidate names. The first
// candidate is also the canonical key itself, so a header literally named
// "case_id", "Case ID", "case-id", "CASE_ID", or "caseId" all auto-map.
const COMMON_GUESSES: Record<keyof CsvMapping, string[]> = {
  case_id: ["case_id", "case", "case concept name", "trace_id", "id"],
  activity: ["activity", "task", "concept name", "event"],
  timestamp: ["timestamp", "time", "datetime", "date", "time timestamp", "start_timestamp", "start"],
  end_timestamp: ["end_timestamp", "complete_timestamp", "time complete", "completion", "end"],
  resource: ["resource", "user", "agent", "org resource", "performer"],
  cost: ["cost", "amount", "cost total", "price"],
  delimiter: [],
  timestamp_format: [],
};

const CANONICAL_FIELDS = [
  "case_id",
  "activity",
  "timestamp",
  "end_timestamp",
  "resource",
  "cost",
] as const;

/** Normalise an identifier for fuzzy comparison: lowercase + strip every
 * character that isn't a letter or digit. So "Case ID", "case-id",
 * "Case:Concept:Name", and "caseConceptName" all collapse to a comparable form.
 */
function normaliseIdent(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function autoMap(headers: string[]): Partial<CsvMapping> {
  const normalisedHeaders = headers.map((h) => ({ raw: h, norm: normaliseIdent(h) }));
  const claimed = new Set<string>();
  const out: Partial<CsvMapping> = {};

  const findFor = (
    key: (typeof CANONICAL_FIELDS)[number],
    predicate: (headerNorm: string, candNorm: string) => boolean,
  ): string | null => {
    for (const cand of COMMON_GUESSES[key]) {
      const candNorm = normaliseIdent(cand);
      if (!candNorm) continue;
      for (const h of normalisedHeaders) {
        if (claimed.has(h.raw)) continue;
        if (predicate(h.norm, candNorm)) return h.raw;
      }
    }
    return null;
  };

  // Pass 1 – exact normalised match. Strongest signal: the user wrote
  // "Case ID" or "case-id" intending the canonical case_id column.
  for (const key of CANONICAL_FIELDS) {
    const found = findFor(key, (h, c) => h === c);
    if (found) {
      out[key] = found;
      claimed.add(found);
    }
  }

  // Pass 2 – substring containment for whatever's still unclaimed. So
  // "registered_case_id" still resolves to case_id, but only if no exact
  // match was found for any other field first.
  for (const key of CANONICAL_FIELDS) {
    if (out[key]) continue;
    const found = findFor(key, (h, c) => h.includes(c) || c.includes(h));
    if (found) {
      out[key] = found;
      claimed.add(found);
    }
  }

  return out;
}

interface ImportFormProps {
  onSuccess?: (logId: string) => void;
}

export function ImportForm({ onSuccess }: ImportFormProps = {}) {
  const router = useProgressRouter();
  const importer = useImportEventLog();
  const probeXml = useProbeXml();
  const probeJson = useProbeJson();
  const { data: aiConfig } = useAiConfig();
  const aiMapping = useImportColumnMapping();
  const track = useTrack();

  const defaultDelimiter = useUi((s) => s.csvDelimiter);
  const defaultTsFormat = useUi((s) => s.csvTimestampFormat);

  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [delimiter, setDelimiter] = useState<string>(defaultDelimiter);
  const [mapping, setMapping] = useState<Partial<CsvMapping>>({});
  const [aiSuggested, setAiSuggested] = useState<Set<keyof CsvMapping>>(new Set());
  const [tsFormat, setTsFormat] = useState<string>(defaultTsFormat);

  // XML wizard state. `xmlProbe` is null until the file has been inspected by
  // the backend; xmlMapping is what we'll actually send on submit.
  const [xmlProbe, setXmlProbe] = useState<XmlProbeResponse | null>(null);
  const [xmlMapping, setXmlMapping] = useState<Partial<XmlMapping>>({});
  const [xmlError, setXmlError] = useState<string | null>(null);

  // JSON wizard state – same shape as XML. `jsonProbe.format_hint === "ocel"`
  // means the server will auto-route it object-centric, so no mapping is shown.
  const [jsonProbe, setJsonProbe] = useState<JsonProbeResponse | null>(null);
  const [jsonMapping, setJsonMapping] = useState<Partial<JsonMapping>>({});
  const [jsonError, setJsonError] = useState<string | null>(null);

  const fmt = file ? detect(file) : null;
  const aiConfigured = Boolean(aiConfig?.selected_provider && aiConfig?.selected_model);

  const onDrop = useCallback(
    async (f: File) => {
      const detected = detect(f);
      if (detected === "unsupported") {
        toastError(
          `Unsupported file: ${f.name}. Use .xes, .csv, .xml, .json, or OCEL ` +
            `(.jsonocel/.xmlocel/.sqlite) - optionally compressed (.gz/.bz2/.xz/.zip).`,
        );
        return;
      }
      setFile(f);
      setName(
        (current) =>
          current ||
          f.name
            .replace(/\.(gz|gzip|bz2|xz|lzma|zip)$/i, "")
            .replace(/\.(xes|csv|xml|json|jsonocel|xmlocel|sqlite)$/i, ""),
      );
      setAiSuggested(new Set());
      setXmlProbe(null);
      setXmlMapping({});
      setXmlError(null);
      setJsonProbe(null);
      setJsonMapping({});
      setJsonError(null);
      if (detected === "json") {
        try {
          const probe = await probeJson.mutateAsync(f);
          setJsonProbe(probe);
          const auto = probe.auto_mapping;
          if (auto) {
            setJsonMapping({
              event_path: auto.event_path ?? undefined,
              case_id: auto.case_id,
              activity: auto.activity,
              timestamp: auto.timestamp,
              end_timestamp: auto.end_timestamp ?? undefined,
              resource: auto.resource ?? undefined,
              cost: auto.cost ?? undefined,
              timestamp_format: auto.timestamp_format ?? undefined,
            });
          } else if (probe.event_path) {
            setJsonMapping({ event_path: probe.event_path });
          }
        } catch (err: unknown) {
          setJsonError((err as Error).message || "Failed to inspect JSON");
        }
        setHeaders([]);
        setMapping({});
        return;
      }
      if (detected === "xml") {
        try {
          const probe = await probeXml.mutateAsync(f);
          setXmlProbe(probe);
          const auto = probe.auto_mapping;
          if (auto) {
            setXmlMapping({
              event_element: auto.event_element,
              case_id: auto.case_id,
              activity: auto.activity,
              timestamp: auto.timestamp,
              end_timestamp: auto.end_timestamp ?? undefined,
              resource: auto.resource ?? undefined,
              cost: auto.cost ?? undefined,
              timestamp_format: auto.timestamp_format ?? undefined,
            });
          } else if (probe.event_element) {
            setXmlMapping({ event_element: probe.event_element });
          }
        } catch (err: unknown) {
          setXmlError((err as Error).message || "Failed to inspect XML");
        }
        setHeaders([]);
        setMapping({});
        return;
      }
      if (detected === "csv") {
        if (isCompressed(f)) {
          // Headers aren't readable client-side from compressed bytes - the
          // server auto-detects column roles at import (fixable afterwards in
          // the log's settings → Column roles).
          setHeaders([]);
          setMapping({});
          return;
        }
        const sample = await readSampleLines(f, 11);
        const headerLine = sample[0] ?? "";
        const cols = parseCsvHeader(headerLine, delimiter);
        setHeaders(cols);
        const base = autoMap(cols);
        setMapping(base);

        // Best-effort AI fill for fields autoMap left blank. Silently no-ops
        // if the user hasn't configured AI; surfaces nothing if the call
        // fails – autoMap's coverage is fine on its own.
        if (aiConfigured && cols.length > 0) {
          const sampleRows = sample
            .slice(1, 11)
            .map((line) => parseCsvHeader(line, delimiter));
          try {
            const res = await aiMapping.mutateAsync({
              headers: cols,
              sample_rows: sampleRows,
            });
            const filled: Partial<CsvMapping> = { ...base };
            const newlySuggested = new Set<keyof CsvMapping>();
            for (const [key, header] of Object.entries(res.suggestions) as [
              keyof CsvMapping,
              string,
            ][]) {
              if (!filled[key] && header && cols.includes(header)) {
                filled[key] = header;
                newlySuggested.add(key);
              }
            }
            if (newlySuggested.size > 0) {
              setMapping(filled);
              setAiSuggested(newlySuggested);
            }
          } catch {
            // Drop silently – autoMap is the source of truth and the user
            // can map manually below.
          }
        }
      } else {
        setHeaders([]);
        setMapping({});
      }
    },
    [delimiter, aiConfigured, aiMapping, probeXml, probeJson],
  );

  const ready = useMemo(() => {
    if (!file) return false;
    if (fmt === "csv") {
      // Compressed CSVs skip the client wizard - the server auto-maps.
      if (isCompressed(file)) return true;
      return Boolean(mapping.case_id && mapping.activity && mapping.timestamp);
    }
    if (fmt === "xml") {
      // XES-shaped or OCEL .xml is handled server-side – no mapping needed.
      // For generic XML we require the four canonical fields.
      if (xmlProbe?.format_hint === "xes" || xmlProbe?.format_hint === "ocel") return true;
      return Boolean(
        xmlMapping.event_element &&
          xmlMapping.case_id &&
          xmlMapping.activity &&
          xmlMapping.timestamp,
      );
    }
    if (fmt === "json") {
      // OCEL .json auto-routes server-side. Generic JSON needs the three
      // mandatory roles (event_path is optional – top-level arrays have none).
      if (jsonProbe?.format_hint === "ocel") return true;
      return Boolean(jsonMapping.case_id && jsonMapping.activity && jsonMapping.timestamp);
    }
    return true;
  }, [file, fmt, mapping, xmlMapping, xmlProbe, jsonMapping, jsonProbe]);

  const submit = async () => {
    if (!file) return;
    track(EV.PROCESS_IMPORT_STARTED, { source: "file", format: fmt });
    try {
      const csvMappingPayload =
        fmt === "csv" && !isCompressed(file)
          ? { ...mapping, delimiter, timestamp_format: tsFormat || undefined }
          : undefined;
      const xmlMappingPayload =
        fmt === "xml" &&
        xmlProbe?.format_hint !== "xes" &&
        xmlProbe?.format_hint !== "ocel" &&
        xmlMapping.event_element
          ? {
              event_element: xmlMapping.event_element,
              case_id: xmlMapping.case_id,
              activity: xmlMapping.activity,
              timestamp: xmlMapping.timestamp,
              end_timestamp: xmlMapping.end_timestamp || undefined,
              resource: xmlMapping.resource || undefined,
              cost: xmlMapping.cost || undefined,
              timestamp_format: xmlMapping.timestamp_format || undefined,
            }
          : undefined;
      const jsonMappingPayload =
        fmt === "json" &&
        jsonProbe?.format_hint !== "ocel" &&
        jsonMapping.case_id
          ? {
              event_path: jsonMapping.event_path || undefined,
              case_id: jsonMapping.case_id,
              activity: jsonMapping.activity,
              timestamp: jsonMapping.timestamp,
              end_timestamp: jsonMapping.end_timestamp || undefined,
              resource: jsonMapping.resource || undefined,
              cost: jsonMapping.cost || undefined,
              timestamp_format: jsonMapping.timestamp_format || undefined,
            }
          : undefined;
      const resp = await importer.mutateAsync({
        file,
        name: name || file.name,
        csvMapping: csvMappingPayload,
        xmlMapping: xmlMappingPayload,
        jsonMapping: jsonMappingPayload,
      });
      track(EV.PROCESS_IMPORT_FINISHED, { source: "file", format: fmt, ok: true });
      toast.success("Import queued");
      if (onSuccess) {
        onSuccess(resp.log_id);
      } else {
        router.push(`/processes?focus=${resp.log_id}`);
      }
    } catch (err: unknown) {
      track(EV.PROCESS_IMPORT_FINISHED, { source: "file", format: fmt, ok: false });
      toastError(`Import failed: ${(err as Error).message}`);
    }
  };

  return (
    <div className="space-y-6">
      <DropZone file={file} onDrop={onDrop} onClear={() => setFile(null)} />

      {!file && (
        <div className="flex items-center justify-center">
          <a
            href="https://www.processmining.org/event-data.html"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Just exploring? Get public event logs from processmining.org
          </a>
        </div>
      )}

      {file && (
        <Card variant="glass">
          <CardContent className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="display-name">Display name</Label>
              <Input
                id="display-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={file.name}
              />
            </div>

            {fmt && <DetectedTypeBanner fmt={fmt} />}

            {(fmt === "zip" || (fmt === "csv" && isCompressed(file))) && (
              <div className="flex items-start gap-2 rounded-md border border-dashed border-border bg-surface px-3 py-2 text-xs text-muted-foreground">
                <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Compressed upload - columns are auto-detected during import. If something
                  maps incorrectly, fix it afterwards in the log&apos;s settings → Column roles.
                </span>
              </div>
            )}

            {fmt === "csv" && !isCompressed(file) && (
              <>
                {aiConfig !== undefined && !aiConfigured && (
                  <div className="flex items-start gap-2 rounded-md border border-dashed border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                    <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>
                      Tip: configure an AI provider in{" "}
                      <a
                        href="/settings/ai"
                        className="font-medium underline underline-offset-2"
                      >
                        Settings → AI
                      </a>{" "}
                      to auto-fill the column mapping for unfamiliar headers.
                    </span>
                  </div>
                )}
                {aiMapping.isPending && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Asking AI for column suggestions…
                  </div>
                )}
                <CsvMappingFields
                  headers={headers}
                  mapping={mapping}
                  setMapping={(m) => {
                    setMapping(m);
                    setAiSuggested(new Set());
                  }}
                  aiSuggested={aiSuggested}
                  delimiter={delimiter}
                  setDelimiter={async (d) => {
                    setDelimiter(d);
                    if (file) {
                      const header = await readFirstLine(file);
                      const cols = parseCsvHeader(header, d);
                      setHeaders(cols);
                      setMapping(autoMap(cols));
                      setAiSuggested(new Set());
                    }
                  }}
                  tsFormat={tsFormat}
                  setTsFormat={setTsFormat}
                />
              </>
            )}

            {fmt === "xml" && (
              <XmlMappingSection
                probe={xmlProbe}
                mapping={xmlMapping}
                setMapping={setXmlMapping}
                loading={probeXml.isPending}
                error={xmlError}
                autoMappingApplied={Boolean(xmlProbe?.auto_mapping)}
              />
            )}

            {fmt === "json" && (
              <JsonMappingSection
                probe={jsonProbe}
                mapping={jsonMapping}
                setMapping={setJsonMapping}
                loading={probeJson.isPending}
                error={jsonError}
                autoMappingApplied={Boolean(jsonProbe?.auto_mapping)}
              />
            )}

            <div className="flex justify-end gap-2 border-t border-border pt-4">
              <Button
                variant="outline"
                onClick={() => router.back()}
                className="cursor-pointer"
              >
                Cancel
              </Button>
              <Button
                onClick={submit}
                disabled={!ready || importer.isPending}
                className="cursor-pointer gap-2"
              >
                {importer.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Import
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function DropZone({
  file,
  onDrop,
  onClear,
}: {
  file: File | null;
  onDrop: (file: File) => void;
  onClear: () => void;
}) {
  const [dragOver, setDragOver] = useState(false);

  if (file) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3">
        <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{file.name}</div>
          <div className="text-xs text-muted-foreground">
            {(file.size / 1024 / 1024).toFixed(2)} MB
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClear}
          className="cursor-pointer"
          aria-label="Remove file"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <label
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onDrop(f);
      }}
      className={cn(
        "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-surface p-12 text-center transition-colors",
        dragOver
          ? "border-primary/60 bg-accent"
          : "border-border hover:border-primary/40 hover:bg-accent/40",
      )}
    >
      <FileUp className="h-8 w-8 text-muted-foreground" />
      <div className="text-sm font-medium">
        Drop an event log here or click to choose a file
      </div>
      <div className="text-xs text-muted-foreground">
        Supports XES, CSV, XML, JSON, and OCEL - plain or compressed (.gz, .bz2, .xz, .zip)
      </div>
      <input
        type="file"
        className="sr-only"
        accept=".xes,.xes.gz,.csv,.xml,.json,.jsonocel,.xmlocel,.sqlite,.gz,.gzip,.bz2,.xz,.lzma,.zip,application/xml,text/xml,text/csv,application/json,application/zip,application/gzip"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onDrop(f);
        }}
      />
    </label>
  );
}

function CsvMappingFields({
  headers,
  mapping,
  setMapping,
  aiSuggested,
  delimiter,
  setDelimiter,
  tsFormat,
  setTsFormat,
}: {
  headers: string[];
  mapping: Partial<CsvMapping>;
  setMapping: (m: Partial<CsvMapping>) => void;
  aiSuggested: Set<keyof CsvMapping>;
  delimiter: string;
  setDelimiter: (d: string) => void;
  tsFormat: string;
  setTsFormat: (s: string) => void;
}) {
  const set = (k: keyof CsvMapping) => (v: string) =>
    setMapping({ ...mapping, [k]: v === "__none__" ? undefined : v });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FieldSelect
          label="Delimiter"
          value={delimiter}
          onChange={setDelimiter}
          options={[
            { value: ",", label: ", (comma)" },
            { value: ";", label: "; (semicolon)" },
            { value: "\t", label: "Tab" },
            { value: "|", label: "| (pipe)" },
          ]}
          required
        />
        <FieldText
          label="Timestamp format (optional)"
          placeholder="e.g. %Y-%m-%d %H:%M:%S"
          value={tsFormat}
          onChange={setTsFormat}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <FieldSelect
          label="case_id"
          value={mapping.case_id ?? ""}
          onChange={set("case_id")}
          options={headers.map((h) => ({ value: h, label: h }))}
          required
          aiSuggested={aiSuggested.has("case_id")}
        />
        <FieldSelect
          label="activity"
          value={mapping.activity ?? ""}
          onChange={set("activity")}
          options={headers.map((h) => ({ value: h, label: h }))}
          required
          aiSuggested={aiSuggested.has("activity")}
        />
        <FieldSelect
          label="timestamp"
          value={mapping.timestamp ?? ""}
          onChange={set("timestamp")}
          options={headers.map((h) => ({ value: h, label: h }))}
          required
          aiSuggested={aiSuggested.has("timestamp")}
        />
        <FieldSelect
          label="end_timestamp"
          value={mapping.end_timestamp ?? "__none__"}
          onChange={set("end_timestamp")}
          options={[{ value: "__none__", label: "–" }, ...headers.map((h) => ({ value: h, label: h }))]}
          aiSuggested={aiSuggested.has("end_timestamp")}
        />
        <FieldSelect
          label="resource"
          value={mapping.resource ?? "__none__"}
          onChange={set("resource")}
          options={[{ value: "__none__", label: "–" }, ...headers.map((h) => ({ value: h, label: h }))]}
          aiSuggested={aiSuggested.has("resource")}
        />
        <FieldSelect
          label="cost"
          value={mapping.cost ?? "__none__"}
          onChange={set("cost")}
          options={[{ value: "__none__", label: "–" }, ...headers.map((h) => ({ value: h, label: h }))]}
          aiSuggested={aiSuggested.has("cost")}
        />
      </div>
    </div>
  );
}

function FieldSelect({
  label,
  value,
  onChange,
  options,
  required,
  aiSuggested,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  required?: boolean;
  aiSuggested?: boolean;
}) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs flex items-center gap-1.5">
        <span>{label}</span>
        {required && <span className="text-destructive">*</span>}
        {aiSuggested && (
          <span className="rounded-sm bg-primary/10 px-1 py-0.5 text-[9px] font-medium uppercase tracking-wide text-primary">
            AI
          </span>
        )}
      </Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="cursor-pointer">
          <SelectValue placeholder="Pick a column" />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value} className="cursor-pointer">
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function FieldText({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs">{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

// ── Detected-format banner ────────────────────────────────────────────────────

// Shows "<Type> detected" for the formats whose mapping section doesn't already
// self-describe (XES, CSV, explicit OCEL). XML / JSON are auto-detected by the
// server after probing, so their banner lives inside their mapping section.
function DetectedTypeBanner({ fmt }: { fmt: DetectedFormat }) {
  const label: Partial<Record<DetectedFormat, string>> = {
    xes: "XES detected",
    "xes.gz": "XES detected",
    csv: "CSV detected",
    ocel: "Object-centric (OCEL) log detected",
    zip: "Zip archive detected - the event log inside will be imported",
  };
  const text = label[fmt];
  if (!text) return null;
  return (
    <div className="flex items-start gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400">
      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{text}</span>
    </div>
  );
}

// ── XML mapping wizard ────────────────────────────────────────────────────────

function XmlMappingSection({
  probe,
  mapping,
  setMapping,
  loading,
  error,
  autoMappingApplied,
}: {
  probe: XmlProbeResponse | null;
  mapping: Partial<XmlMapping>;
  setMapping: (m: Partial<XmlMapping>) => void;
  loading: boolean;
  error: string | null;
  autoMappingApplied: boolean;
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        Inspecting XML structure…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
        {error}
      </div>
    );
  }

  if (probe?.format_hint === "xes") {
    return (
      <div className="flex items-start gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400">
        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>XES detected</span>
      </div>
    );
  }

  if (probe?.format_hint === "ocel") {
    return (
      <div className="flex items-start gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400">
        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>Object-centric (OCEL) log detected</span>
      </div>
    );
  }

  if (!probe || !probe.event_element) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
        No event records found in this XML - it can&apos;t be imported.
      </div>
    );
  }

  const fieldNames = probe.fields.map((f) => f.name);
  const set = (k: XmlMappingFieldKey) => (v: string) =>
    setMapping({ ...mapping, [k]: v === "__none__" ? undefined : v });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>
          Detected event element:{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
            &lt;{probe.event_element}&gt;
          </code>
          {probe.events_sampled > 0 && (
            <span className="ml-1">({probe.events_sampled} sampled)</span>
          )}
        </span>
        {autoMappingApplied && (
          <span className="rounded-sm bg-primary/10 px-1 py-0.5 text-[9px] font-medium uppercase tracking-wide text-primary">
            Auto-mapped
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FieldText
          label="Event element"
          value={mapping.event_element ?? probe.event_element ?? ""}
          onChange={(v) => setMapping({ ...mapping, event_element: v })}
          placeholder={probe.event_element ?? "event"}
        />
        <FieldText
          label="Timestamp format (optional)"
          placeholder="e.g. %Y-%m-%d %H:%M:%S"
          value={mapping.timestamp_format ?? ""}
          onChange={(v) => setMapping({ ...mapping, timestamp_format: v })}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <FieldSelect
          label="case_id"
          value={mapping.case_id ?? ""}
          onChange={set("case_id")}
          options={fieldNames.map((h) => ({ value: h, label: h }))}
          required
        />
        <FieldSelect
          label="activity"
          value={mapping.activity ?? ""}
          onChange={set("activity")}
          options={fieldNames.map((h) => ({ value: h, label: h }))}
          required
        />
        <FieldSelect
          label="timestamp"
          value={mapping.timestamp ?? ""}
          onChange={set("timestamp")}
          options={fieldNames.map((h) => ({ value: h, label: h }))}
          required
        />
        <FieldSelect
          label="end_timestamp"
          value={mapping.end_timestamp ?? "__none__"}
          onChange={set("end_timestamp")}
          options={[
            { value: "__none__", label: "–" },
            ...fieldNames.map((h) => ({ value: h, label: h })),
          ]}
        />
        <FieldSelect
          label="resource"
          value={mapping.resource ?? "__none__"}
          onChange={set("resource")}
          options={[
            { value: "__none__", label: "–" },
            ...fieldNames.map((h) => ({ value: h, label: h })),
          ]}
        />
        <FieldSelect
          label="cost"
          value={mapping.cost ?? "__none__"}
          onChange={set("cost")}
          options={[
            { value: "__none__", label: "–" },
            ...fieldNames.map((h) => ({ value: h, label: h })),
          ]}
        />
      </div>
    </div>
  );
}

// ── JSON mapping wizard ───────────────────────────────────────────────────────

function JsonMappingSection({
  probe,
  mapping,
  setMapping,
  loading,
  error,
  autoMappingApplied,
}: {
  probe: JsonProbeResponse | null;
  mapping: Partial<JsonMapping>;
  setMapping: (m: Partial<JsonMapping>) => void;
  loading: boolean;
  error: string | null;
  autoMappingApplied: boolean;
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        Inspecting JSON structure…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
        {error}
      </div>
    );
  }

  if (probe?.format_hint === "ocel") {
    return (
      <div className="flex items-start gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400">
        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>Object-centric (OCEL) log detected</span>
      </div>
    );
  }

  if (!probe || probe.fields.length === 0) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
        No event records found in this JSON - it can&apos;t be imported.
      </div>
    );
  }

  const fieldNames = probe.fields.map((f) => f.name);
  const set = (k: JsonMappingFieldKey) => (v: string) =>
    setMapping({ ...mapping, [k]: v === "__none__" ? undefined : v });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>
          Detected event array
          {probe.event_path && (
            <>
              {" "}
              at{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
                {probe.event_path}
              </code>
            </>
          )}
          {probe.events_sampled > 0 && (
            <span className="ml-1">({probe.events_sampled} sampled)</span>
          )}
        </span>
        {autoMappingApplied && (
          <span className="rounded-sm bg-primary/10 px-1 py-0.5 text-[9px] font-medium uppercase tracking-wide text-primary">
            Auto-mapped
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FieldText
          label="Array key (optional)"
          value={mapping.event_path ?? ""}
          onChange={(v) => setMapping({ ...mapping, event_path: v })}
          placeholder={probe.event_path ?? "(top-level array)"}
        />
        <FieldText
          label="Timestamp format (optional)"
          placeholder="e.g. %Y-%m-%d %H:%M:%S"
          value={mapping.timestamp_format ?? ""}
          onChange={(v) => setMapping({ ...mapping, timestamp_format: v })}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <FieldSelect
          label="case_id"
          value={mapping.case_id ?? ""}
          onChange={set("case_id")}
          options={fieldNames.map((h) => ({ value: h, label: h }))}
          required
        />
        <FieldSelect
          label="activity"
          value={mapping.activity ?? ""}
          onChange={set("activity")}
          options={fieldNames.map((h) => ({ value: h, label: h }))}
          required
        />
        <FieldSelect
          label="timestamp"
          value={mapping.timestamp ?? ""}
          onChange={set("timestamp")}
          options={fieldNames.map((h) => ({ value: h, label: h }))}
          required
        />
        <FieldSelect
          label="end_timestamp"
          value={mapping.end_timestamp ?? "__none__"}
          onChange={set("end_timestamp")}
          options={[
            { value: "__none__", label: "–" },
            ...fieldNames.map((h) => ({ value: h, label: h })),
          ]}
        />
        <FieldSelect
          label="resource"
          value={mapping.resource ?? "__none__"}
          onChange={set("resource")}
          options={[
            { value: "__none__", label: "–" },
            ...fieldNames.map((h) => ({ value: h, label: h })),
          ]}
        />
        <FieldSelect
          label="cost"
          value={mapping.cost ?? "__none__"}
          onChange={set("cost")}
          options={[
            { value: "__none__", label: "–" },
            ...fieldNames.map((h) => ({ value: h, label: h })),
          ]}
        />
      </div>
    </div>
  );
}
