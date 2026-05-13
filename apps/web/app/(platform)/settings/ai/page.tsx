"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Eye, EyeOff, Loader2, RefreshCw, Upload } from "lucide-react";
import { toast } from "sonner";

import { toastError } from "@/lib/toast";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import {
  DEFAULT_AI_CONFIG,
  cleanDisplayName,
  deriveParameters,
  fallbackContext,
  lookupPricing,
  perMillion,
  useAiConfig,
  useFetchProviderModels,
  usePricingCatalog,
  useUpdateAiConfig,
  type AiConfig,
  type AiProvider,
  type ModelInfo,
  type PricingCatalog,
  type ProviderConfig,
} from "@/lib/ai-queries";

interface ProviderMeta {
  id: AiProvider;
  label: string;
  blurb: string;
  needsBaseUrl: boolean;
  baseUrlPlaceholder?: string;
}

const PROVIDERS: ProviderMeta[] = [
  {
    id: "anthropic",
    label: "Anthropic",
    blurb: "Claude models. Key is sent only to api.anthropic.com via the backend proxy.",
    needsBaseUrl: false,
  },
  {
    id: "openai",
    label: "OpenAI",
    blurb: "GPT and o-series models. Key is proxied through the backend to api.openai.com.",
    needsBaseUrl: false,
  },
  {
    id: "unigpt",
    label: "UniGPT (LibreChat)",
    blurb:
      "Any OpenAI-compatible endpoint exposed by a LibreChat / UniGPT deployment. Base URL must include the versioned API prefix (e.g. https://gpt.uni-muenster.de/v1).",
    needsBaseUrl: true,
    baseUrlPlaceholder: "https://chat.example.com/v1",
  },
];

function configsEqual(a: AiConfig, b: AiConfig): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export default function AiSettingsPage() {
  const { data: stored, isLoading, isError, error } = useAiConfig();
  const update = useUpdateAiConfig();
  const fetchModels = useFetchProviderModels();
  const { data: pricing } = usePricingCatalog();

  const [draft, setDraft] = useState<AiConfig>(DEFAULT_AI_CONFIG);
  const [models, setModels] = useState<Record<AiProvider, ModelInfo[]>>({
    anthropic: [],
    openai: [],
    unigpt: [],
  });
  const [busyProvider, setBusyProvider] = useState<AiProvider | null>(null);

  useEffect(() => {
    if (stored) setDraft(stored);
  }, [stored]);

  const dirty = useMemo(
    () => (stored ? !configsEqual(stored, draft) : false),
    [stored, draft],
  );

  const setProvider = (id: AiProvider, patch: Partial<ProviderConfig>) => {
    setDraft((d) => ({ ...d, [id]: { ...d[id], ...patch } }));
  };

  const saveDraft = async (next: AiConfig = draft): Promise<AiConfig> => {
    const saved = await update.mutateAsync(next);
    return saved;
  };

  const onSave = async () => {
    try {
      await saveDraft();
      toast.success("AI settings saved");
    } catch (e) {
      toastError(`Save failed: ${(e as Error).message}`);
    }
  };

  const onFetchModels = async (provider: AiProvider) => {
    setBusyProvider(provider);
    try {
      // Persist any pending edits first so the backend reads the same key.
      if (dirty) await saveDraft();
      const res = await fetchModels.mutateAsync(provider);
      setModels((m) => ({ ...m, [provider]: res.models }));
      toast.success(`Fetched ${res.models.length} model${res.models.length === 1 ? "" : "s"}`);
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? typeof e.detail === "object" && e.detail !== null
            ? JSON.stringify(e.detail)
            : String(e.detail)
          : (e as Error).message;
      toastError(`Could not fetch models: ${msg}`);
    } finally {
      setBusyProvider(null);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (isError || !stored) {
    return (
      <p className="text-sm text-destructive">
        Could not load AI settings: {(error as Error)?.message ?? "unknown"}
      </p>
    );
  }

  const allKnownModels: { provider: AiProvider; model: ModelInfo }[] = (
    ["anthropic", "openai", "unigpt"] as const
  ).flatMap((p) => models[p].map((m) => ({ provider: p, model: m })));

  return (
    <div className="space-y-4">
      <SystemPromptCard
        value={draft.system_prompt}
        onChange={(v) => setDraft((d) => ({ ...d, system_prompt: v }))}
      />

      {PROVIDERS.map((p) => (
        <ProviderCard
          key={p.id}
          meta={p}
          config={draft[p.id]}
          onChange={(patch) => setProvider(p.id, patch)}
          onFetch={() => onFetchModels(p.id)}
          busy={busyProvider === p.id}
          models={models[p.id]}
          pricing={pricing}
        />
      ))}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Default model</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Used by ATLAS AI when a model isn&apos;t specified per-conversation. Fetch each
            provider&apos;s models above first to populate the list.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Provider</Label>
              <Select
                value={draft.selected_provider ?? "__none"}
                onValueChange={(v) =>
                  setDraft((d) => ({
                    ...d,
                    selected_provider: v === "__none" ? null : (v as AiProvider),
                    selected_model: null,
                  }))
                }
              >
                <SelectTrigger className="text-xs">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">None</SelectItem>
                  <SelectItem value="anthropic">Anthropic</SelectItem>
                  <SelectItem value="openai">OpenAI</SelectItem>
                  <SelectItem value="unigpt">UniGPT</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Model</Label>
              <Select
                value={draft.selected_model ?? "__none"}
                onValueChange={(v) =>
                  setDraft((d) => ({ ...d, selected_model: v === "__none" ? null : v }))
                }
                disabled={!draft.selected_provider}
              >
                <SelectTrigger className="text-xs">
                  <SelectValue placeholder={draft.selected_provider ? "Choose a model" : "Pick a provider"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">None</SelectItem>
                  {draft.selected_provider &&
                    models[draft.selected_provider].map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.display_name ?? cleanDisplayName(m.id)}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {draft.selected_provider &&
            models[draft.selected_provider].length === 0 &&
            allKnownModels.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No models fetched yet for {draft.selected_provider}. Click <em>Fetch models</em> in
                that section.
              </p>
            )}
        </CardContent>
      </Card>

      <div className="sticky bottom-0 z-10 flex items-center justify-end gap-2 border-t border-border bg-background/80 py-3 backdrop-blur">
        {dirty && (
          <span className="text-xs text-muted-foreground mr-auto">
            Unsaved changes
          </span>
        )}
        <Button
          variant="outline"
          size="sm"
          className="cursor-pointer"
          onClick={() => stored && setDraft(stored)}
          disabled={!dirty || update.isPending}
        >
          Revert
        </Button>
        <Button
          size="sm"
          className="cursor-pointer"
          onClick={onSave}
          disabled={!dirty || update.isPending}
        >
          {update.isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------
// System prompt card — textarea with load-from-file and download buttons
// --------------------------------------------------------------------------

function SystemPromptCard({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  const onFile = async (file: File) => {
    try {
      const text = await file.text();
      onChange(text);
      toast.success(`Loaded ${file.name} (${text.length.toLocaleString()} chars)`);
    } catch (e) {
      toastError(`Could not read file: ${(e as Error).message}`);
    }
  };

  const onDownload = () => {
    const blob = new Blob([value], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "system-prompt.txt";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">System prompt</CardTitle>
          <div className="flex items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".txt,.md,text/plain,text/markdown"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onFile(f);
                e.target.value = "";
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="cursor-pointer gap-1.5"
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="h-3.5 w-3.5" />
              Load from file
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="cursor-pointer gap-1.5"
              onClick={onDownload}
              disabled={!value}
            >
              <Download className="h-3.5 w-3.5" />
              Download
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground">
          Prepended to every ATLAS AI conversation. Plain text or markdown; whitespace is preserved.
        </p>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={10}
          placeholder="You are ATLAS, an analyst assistant…"
          className={cn(
            "block w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs leading-relaxed shadow-xs",
            "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
            "placeholder:text-muted-foreground",
          )}
        />
        <p className="text-[10px] text-muted-foreground tabular-nums">
          {value.length.toLocaleString()} characters
        </p>
      </CardContent>
    </Card>
  );
}

// --------------------------------------------------------------------------
// Provider card — API key, base URL (UniGPT), Fetch models button + table
// --------------------------------------------------------------------------

function ProviderCard({
  meta,
  config,
  onChange,
  onFetch,
  busy,
  models,
  pricing,
}: {
  meta: ProviderMeta;
  config: ProviderConfig;
  onChange: (patch: Partial<ProviderConfig>) => void;
  onFetch: () => void;
  busy: boolean;
  models: ModelInfo[];
  pricing: PricingCatalog | undefined;
}) {
  const [showKey, setShowKey] = useState(false);
  const canFetch = Boolean(config.api_key && (!meta.needsBaseUrl || config.base_url));

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{meta.label}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">{meta.blurb}</p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={`${meta.id}-key`}>API key</Label>
            <div className="relative">
              <Input
                id={`${meta.id}-key`}
                type={showKey ? "text" : "password"}
                autoComplete="off"
                spellCheck={false}
                value={config.api_key ?? ""}
                onChange={(e) => onChange({ api_key: e.target.value || null })}
                placeholder={meta.id === "anthropic" ? "sk-ant-…" : "sk-…"}
                className="pr-9 font-mono text-xs"
              />
              <button
                type="button"
                aria-label={showKey ? "Hide key" : "Show key"}
                onClick={() => setShowKey((s) => !s)}
                className="absolute inset-y-0 right-0 flex w-9 cursor-pointer items-center justify-center text-muted-foreground hover:text-foreground"
              >
                {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>

          {meta.needsBaseUrl && (
            <div className="space-y-1.5">
              <Label htmlFor={`${meta.id}-base`}>Base URL</Label>
              <Input
                id={`${meta.id}-base`}
                type="url"
                autoComplete="off"
                spellCheck={false}
                value={config.base_url ?? ""}
                onChange={(e) => onChange({ base_url: e.target.value || null })}
                placeholder={meta.baseUrlPlaceholder}
                className="font-mono text-xs"
              />
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground tabular-nums">
            {models.length > 0
              ? `${models.length} model${models.length === 1 ? "" : "s"} available`
              : "No models fetched yet"}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="cursor-pointer gap-1.5"
            onClick={onFetch}
            disabled={!canFetch || busy}
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Fetch models
          </Button>
        </div>

        {models.length > 0 && <ModelsTable provider={meta.id} models={models} pricing={pricing} />}
      </CardContent>
    </Card>
  );
}

// --------------------------------------------------------------------------
// Models table
// --------------------------------------------------------------------------

type CostCell = number | "free" | null;

function ModelsTable({
  provider,
  models,
  pricing,
}: {
  provider: AiProvider;
  models: ModelInfo[];
  pricing: PricingCatalog | undefined;
}) {
  const rows = useMemo(
    () =>
      [...models].sort((a, b) => a.id.localeCompare(b.id)).map((m) => {
        const price = lookupPricing(pricing, m.id);
        // UniGPT is a free university-hosted LibreChat — costs are always $0.
        const isFree = provider === "unigpt";
        const context =
          price?.max_input_tokens ?? price?.max_tokens ?? fallbackContext(m.id) ?? null;
        return {
          id: m.id,
          display: m.display_name ?? cleanDisplayName(m.id),
          params: deriveParameters(m.id),
          input: (isFree ? "free" : perMillion(price?.input_cost_per_token)) as CostCell,
          output: (isFree ? "free" : perMillion(price?.output_cost_per_token)) as CostCell,
          context,
        };
      }),
    [models, pricing, provider],
  );

  return (
    <div className="rounded-md border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs">Model</TableHead>
            <TableHead className="text-right text-xs">Params</TableHead>
            <TableHead className="text-right text-xs">Input $/M</TableHead>
            <TableHead className="text-right text-xs">Output $/M</TableHead>
            <TableHead className="text-right text-xs">Context</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={`${provider}-${r.id}`}>
              <TableCell className="font-mono text-xs">{r.display}</TableCell>
              <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                {r.params ?? "—"}
              </TableCell>
              <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                {formatCost(r.input)}
              </TableCell>
              <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                {formatCost(r.output)}
              </TableCell>
              <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                {r.context !== null ? formatContext(r.context) : "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function formatCost(v: CostCell): React.ReactNode {
  if (v === "free") {
    return <span className="text-emerald-600 dark:text-emerald-400">Free</span>;
  }
  if (v === null) return "—";
  if (v >= 100) return `$${v.toFixed(0)}`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(3)}`;
}

function formatContext(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
  return tokens.toLocaleString();
}
