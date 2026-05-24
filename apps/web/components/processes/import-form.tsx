"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  FileText,
  FileUp,
  FolderOpen,
  Link2,
  Loader2,
  X,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { toastError } from "@/lib/toast";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useCreateFolder,
  useImportEventLog,
  useImportEventLogFromUrl,
} from "@/lib/queries";
import { useUi } from "@/lib/stores/ui";
import { cn } from "@/lib/cn";

type DetectedFormat = "xes" | "xes.gz" | "csv" | "unsupported";

function detect(file: File): DetectedFormat {
  const n = file.name.toLowerCase();
  if (n.endsWith(".xes.gz")) return "xes.gz";
  if (n.endsWith(".xes")) return "xes";
  if (n.endsWith(".csv")) return "csv";
  return "unsupported";
}

async function readFirstLine(file: File): Promise<string> {
  // Read up to 4KB — far more than we need for headers, less than what would
  // hurt to slurp synchronously into memory.
  const blob = file.slice(0, 4096);
  const text = await blob.text();
  return text.split(/\r?\n/, 1)[0] ?? "";
}

function parseCsvHeader(line: string, delimiter: string): string[] {
  // Minimal split — quoted commas in headers are vanishingly rare; the
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

  // Pass 1 — exact normalised match. Strongest signal: the user wrote
  // "Case ID" or "case-id" intending the canonical case_id column.
  for (const key of CANONICAL_FIELDS) {
    const found = findFor(key, (h, c) => h === c);
    if (found) {
      out[key] = found;
      claimed.add(found);
    }
  }

  // Pass 2 — substring containment for whatever's still unclaimed. So
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

type ImportTab = "file" | "url" | "folder";

interface ImportFormProps {
  onSuccess?: (logId: string) => void;
}

export function ImportForm({ onSuccess }: ImportFormProps = {}) {
  const [tab, setTab] = useState<ImportTab>("file");

  const tabBtn = (
    key: ImportTab,
    label: string,
    Icon: typeof FileUp,
  ) => (
    <button
      key={key}
      onClick={() => setTab(key)}
      className={cn(
        "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer",
        tab === key
          ? "bg-background shadow-sm text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );

  return (
    <div className="space-y-6">
      <div className="flex gap-1 rounded-lg border border-border bg-muted/40 p-1 w-fit">
        {tabBtn("file", "Upload file", FileUp)}
        {tabBtn("url", "From URL", Link2)}
        {tabBtn("folder", "Upload folder", FolderOpen)}
      </div>

      {tab === "file" && <FileImportForm onSuccess={onSuccess} />}
      {tab === "url" && <UrlImportForm onSuccess={onSuccess} />}
      {tab === "folder" && <FolderImportForm onSuccess={onSuccess} />}
    </div>
  );
}

// ── File upload form ──────────────────────────────────────────────────────────

function FileImportForm({ onSuccess }: ImportFormProps) {
  const router = useRouter();
  const importer = useImportEventLog();

  const defaultDelimiter = useUi((s) => s.csvDelimiter);
  const defaultTsFormat = useUi((s) => s.csvTimestampFormat);

  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [delimiter, setDelimiter] = useState<string>(defaultDelimiter);
  const [mapping, setMapping] = useState<Partial<CsvMapping>>({});
  const [tsFormat, setTsFormat] = useState<string>(defaultTsFormat);

  const fmt = file ? detect(file) : null;

  const onDrop = useCallback(
    async (f: File) => {
      const detected = detect(f);
      if (detected === "unsupported") {
        toastError(`Unsupported file: ${f.name}. Use .xes, .xes.gz, or .csv.`);
        return;
      }
      setFile(f);
      setName((current) => current || f.name.replace(/\.(xes|xes\.gz|csv)$/i, ""));
      if (detected === "csv") {
        const header = await readFirstLine(f);
        const cols = parseCsvHeader(header, delimiter);
        setHeaders(cols);
        setMapping(autoMap(cols));
      } else {
        setHeaders([]);
        setMapping({});
      }
    },
    [delimiter],
  );

  const ready = useMemo(() => {
    if (!file) return false;
    if (fmt === "csv") {
      return Boolean(mapping.case_id && mapping.activity && mapping.timestamp);
    }
    return true;
  }, [file, fmt, mapping]);

  const submit = async () => {
    if (!file) return;
    try {
      const csvMapping = fmt === "csv" ? { ...mapping, delimiter, timestamp_format: tsFormat || undefined } : undefined;
      const resp = await importer.mutateAsync({
        file,
        name: name || file.name,
        csvMapping,
      });
      toast.success("Import queued");
      if (onSuccess) {
        onSuccess(resp.log_id);
      } else {
        router.push(`/processes?focus=${resp.log_id}`);
      }
    } catch (err: unknown) {
      toastError(`Import failed: ${(err as Error).message}`);
    }
  };

  return (
    <div className="space-y-6">
      <DropZone file={file} onDrop={onDrop} onClear={() => setFile(null)} />

      {file && (
        <Card>
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

            {fmt === "csv" && (
              <CsvMappingFields
                headers={headers}
                mapping={mapping}
                setMapping={setMapping}
                delimiter={delimiter}
                setDelimiter={async (d) => {
                  setDelimiter(d);
                  if (file) {
                    const header = await readFirstLine(file);
                    const cols = parseCsvHeader(header, d);
                    setHeaders(cols);
                    setMapping(autoMap(cols));
                  }
                }}
                tsFormat={tsFormat}
                setTsFormat={setTsFormat}
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

// ── URL import form ───────────────────────────────────────────────────────────

function isValidUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function UrlImportForm({ onSuccess }: ImportFormProps) {
  const router = useRouter();
  const importer = useImportEventLogFromUrl();

  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [urlTouched, setUrlTouched] = useState(false);

  const urlValid = isValidUrl(url);
  const urlError = urlTouched && url.length > 0 && !urlValid;

  const submit = async () => {
    if (!urlValid) return;
    try {
      const resp = await importer.mutateAsync({
        url,
        name: name.trim() || undefined,
      });
      toast.success("Import queued");
      if (onSuccess) {
        onSuccess(resp.log_id);
      } else {
        router.push(`/processes?focus=${resp.log_id}`);
      }
    } catch (err: unknown) {
      toastError(`Import failed: ${(err as Error).message}`);
    }
  };

  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="grid gap-2">
          <Label htmlFor="url-input">
            URL <span className="text-destructive">*</span>
          </Label>
          <Input
            id="url-input"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onBlur={() => setUrlTouched(true)}
            placeholder="https://example.com/event-log.xes"
            className={cn(urlError && "border-destructive focus-visible:ring-destructive")}
          />
          {urlError ? (
            <p className="text-xs text-destructive">Enter a valid https:// or http:// URL.</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              The file must be publicly accessible and end with .xes, .xes.gz, or .csv.
            </p>
          )}
        </div>

        <div className="grid gap-2">
          <Label htmlFor="url-name">Display name (optional)</Label>
          <Input
            id="url-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Leave blank to use the filename from the URL"
          />
        </div>

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
            disabled={!urlValid || importer.isPending}
            className="cursor-pointer gap-2"
          >
            {importer.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Import
          </Button>
        </div>
      </CardContent>
    </Card>
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
      <div className="text-sm font-medium">Drop a XES, XES.gz, or CSV here</div>
      <div className="text-xs text-muted-foreground">Or click to choose a file</div>
      <input
        type="file"
        className="sr-only"
        accept=".xes,.xes.gz,.csv,application/xml,text/xml,text/csv"
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
  delimiter,
  setDelimiter,
  tsFormat,
  setTsFormat,
}: {
  headers: string[];
  mapping: Partial<CsvMapping>;
  setMapping: (m: Partial<CsvMapping>) => void;
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
        />
        <FieldSelect
          label="activity"
          value={mapping.activity ?? ""}
          onChange={set("activity")}
          options={headers.map((h) => ({ value: h, label: h }))}
          required
        />
        <FieldSelect
          label="timestamp"
          value={mapping.timestamp ?? ""}
          onChange={set("timestamp")}
          options={headers.map((h) => ({ value: h, label: h }))}
          required
        />
        <FieldSelect
          label="end_timestamp"
          value={mapping.end_timestamp ?? "__none__"}
          onChange={set("end_timestamp")}
          options={[{ value: "__none__", label: "—" }, ...headers.map((h) => ({ value: h, label: h }))]}
        />
        <FieldSelect
          label="resource"
          value={mapping.resource ?? "__none__"}
          onChange={set("resource")}
          options={[{ value: "__none__", label: "—" }, ...headers.map((h) => ({ value: h, label: h }))]}
        />
        <FieldSelect
          label="cost"
          value={mapping.cost ?? "__none__"}
          onChange={set("cost")}
          options={[{ value: "__none__", label: "—" }, ...headers.map((h) => ({ value: h, label: h }))]}
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
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  required?: boolean;
}) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs">
        {label}
        {required && <span className="text-destructive"> *</span>}
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

// ── Folder import form ────────────────────────────────────────────────────────

type ItemStatus = "pending" | "uploading" | "done" | "failed";

interface FolderItem {
  file: File;
  relativePath: string;
  format: DetectedFormat;
  status: ItemStatus;
  error?: string;
}

interface SelectedFolder {
  rootName: string;
  items: FolderItem[];
}

/** Files surfaced by `webkitdirectory` carry their relative path via
 * `webkitRelativePath`. We split that into segments to (a) derive the
 * top-level folder name and (b) build a clean display name per file. */
function collectFolderItems(files: FileList): SelectedFolder | null {
  const list: File[] = Array.from(files);
  if (list.length === 0) return null;

  // Every file shares the same first path segment when the user picks a folder.
  const firstRel = (list[0] as File & { webkitRelativePath?: string })
    .webkitRelativePath;
  const rootName = (firstRel?.split("/")[0] ?? "Imported").trim() || "Imported";

  const items: FolderItem[] = [];
  for (const f of list) {
    const rel =
      (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    const fmt = detect(f);
    if (fmt === "unsupported") continue; // silently skip non-log files (READMEs, .DS_Store…)
    items.push({ file: f, relativePath: rel, format: fmt, status: "pending" });
  }
  // Stable order — by relative path so subdirs cluster.
  items.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return { rootName, items };
}

function FolderImportForm({ onSuccess }: ImportFormProps) {
  const router = useRouter();
  const importer = useImportEventLog();
  const createFolder = useCreateFolder();

  const [picked, setPicked] = useState<SelectedFolder | null>(null);
  const [folderName, setFolderName] = useState("");
  const [running, setRunning] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const onPick = (files: FileList | null) => {
    if (!files) return;
    const collected = collectFolderItems(files);
    if (!collected || collected.items.length === 0) {
      toastError("No supported files found (.xes, .xes.gz, or .csv).");
      return;
    }
    setPicked(collected);
    setFolderName(collected.rootName);
  };

  const reset = () => {
    setPicked(null);
    setFolderName("");
    if (inputRef.current) inputRef.current.value = "";
  };

  const totalDone = useMemo(
    () =>
      picked
        ? picked.items.filter((i) => i.status === "done" || i.status === "failed").length
        : 0,
    [picked],
  );

  const submit = async () => {
    if (!picked) return;
    const cleanName = folderName.trim() || picked.rootName;

    setRunning(true);
    try {
      // 1. Create the destination folder so every file has a home.
      const folder = await createFolder.mutateAsync({ name: cleanName, parent_id: null });

      // 2. Upload files sequentially so the per-file progress is meaningful
      //    and the server isn't slammed with N parallel multiparts.
      let failed = 0;
      let ok = 0;
      const lastIdx = picked.items.length - 1;
      let firstLogId: string | null = null;

      for (let i = 0; i < picked.items.length; i++) {
        // Mark uploading.
        setPicked((cur) =>
          cur
            ? {
                ...cur,
                items: cur.items.map((it, idx) =>
                  idx === i ? { ...it, status: "uploading" } : it,
                ),
              }
            : cur,
        );
        try {
          const cleanFileName = picked.items[i].file.name.replace(
            /\.(xes\.gz|xes|csv)$/i,
            "",
          );
          const resp = await importer.mutateAsync({
            file: picked.items[i].file,
            name: cleanFileName,
            folderId: folder.id,
            // No csv_mapping in bulk mode — backend auto-detects for CSVs and
            // surfaces a failure status if it can't (user can re-run later).
          });
          if (firstLogId === null) firstLogId = resp.log_id;
          ok++;
          setPicked((cur) =>
            cur
              ? {
                  ...cur,
                  items: cur.items.map((it, idx) =>
                    idx === i ? { ...it, status: "done" } : it,
                  ),
                }
              : cur,
          );
        } catch (err) {
          failed++;
          setPicked((cur) =>
            cur
              ? {
                  ...cur,
                  items: cur.items.map((it, idx) =>
                    idx === i
                      ? { ...it, status: "failed", error: (err as Error).message }
                      : it,
                  ),
                }
              : cur,
          );
        }
        void lastIdx;
      }

      if (ok > 0 && failed === 0) {
        toast.success(`Imported ${ok} log${ok === 1 ? "" : "s"} into "${cleanName}"`);
      } else if (ok > 0 && failed > 0) {
        toast.warning(`Imported ${ok}, ${failed} failed — see status below`);
      } else {
        toastError(`All ${failed} uploads failed`);
      }

      if (ok > 0) {
        if (onSuccess && firstLogId) {
          onSuccess(firstLogId);
        } else {
          router.push("/processes");
        }
      }
    } catch (err) {
      toastError(`Folder import failed: ${(err as Error).message}`);
    } finally {
      setRunning(false);
    }
  };

  if (!picked) {
    return (
      <label
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-surface p-12 text-center transition-colors",
          "border-border hover:border-primary/40 hover:bg-accent/40",
        )}
      >
        <FolderOpen className="h-8 w-8 text-muted-foreground" />
        <div className="text-sm font-medium">Select a folder of event logs</div>
        <div className="text-xs text-muted-foreground">
          All .xes, .xes.gz, and .csv files inside will be imported into a new
          folder named after the selected directory.
        </div>
        <input
          ref={inputRef}
          type="file"
          className="sr-only"
          // The two non-standard attributes that surface every file inside the
          // chosen folder. React's typings don't include them.
          {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
          multiple
          onChange={(e) => onPick(e.target.files)}
        />
      </label>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="grid gap-2">
          <Label htmlFor="folder-name">Folder name</Label>
          <Input
            id="folder-name"
            value={folderName}
            onChange={(e) => setFolderName(e.target.value)}
            placeholder={picked.rootName}
            disabled={running}
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {picked.items.length} file{picked.items.length === 1 ? "" : "s"} ready
            </span>
            {running && (
              <span>
                {totalDone} / {picked.items.length}
              </span>
            )}
          </div>
          {running && (
            <Progress
              value={(totalDone / Math.max(1, picked.items.length)) * 100}
              className="h-1"
            />
          )}
        </div>

        <div className="max-h-72 overflow-y-auto rounded-md border border-border">
          <ul className="divide-y divide-border text-xs">
            {picked.items.map((it, idx) => (
              <li key={idx} className="flex items-center gap-2 px-3 py-2">
                <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate font-mono">
                  {it.relativePath}
                </span>
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {it.format}
                </span>
                <StatusIcon status={it.status} error={it.error} />
              </li>
            ))}
          </ul>
        </div>

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button
            variant="outline"
            onClick={running ? () => router.back() : reset}
            disabled={running}
            className="cursor-pointer"
          >
            {running ? "Cancel" : "Pick another folder"}
          </Button>
          <Button
            onClick={submit}
            disabled={running || picked.items.length === 0}
            className="cursor-pointer gap-2"
          >
            {running && <Loader2 className="h-4 w-4 animate-spin" />}
            {running ? "Importing…" : `Import ${picked.items.length} file${picked.items.length === 1 ? "" : "s"}`}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function StatusIcon({ status, error }: { status: ItemStatus; error?: string }) {
  if (status === "uploading")
    return <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />;
  if (status === "done") return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
  if (status === "failed")
    return (
      <span title={error} className="inline-flex">
        <XCircle className="h-3.5 w-3.5 text-destructive" />
      </span>
    );
  return <span className="h-3.5 w-3.5" />;
}
