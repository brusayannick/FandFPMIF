"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, FileBox, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { toastError } from "@/lib/toast";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { EmptyState } from "@/components/empty-state";
import { ModuleLogsTail } from "@/components/settings/module-logs-tail";
import { ModelStoreCard } from "@/components/settings/model-store-card";
import {
  AiKeysBanner,
  AiModelPicker,
  type AiModelSelection,
} from "@/components/ai/ai-model-picker";
import {
  ModuleOpenAiCard,
  EMPTY_MODULE_AI_DRAFT,
  readModuleAiDraft,
  type ModuleAiDraft,
} from "@/components/ai/module-openai-card";
import type { AiProvider } from "@/lib/ai-queries";
import {
  useModuleConfig,
  useModuleManifest,
  useRecreateModuleIndex,
  useUninstallModule,
  useUpdateModuleConfig,
  type AiModelsManifest,
  type ModelStoreManifest,
} from "@/lib/queries";

interface PropSchema {
  type?: string;
  title?: string;
  description?: string;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  step?: number;
  enum?: string[];
  ui?: { widget?: string; group?: string };
}
interface ConfigSchema {
  properties?: Record<string, PropSchema>;
}

interface AiConfigDraft {
  llm: AiModelSelection;
  embedding: AiModelSelection;
}

const EMPTY_AI_DRAFT: AiConfigDraft = {
  llm: { provider: null, model: null },
  embedding: { provider: null, model: null, dimensions: null },
};

const EMBEDDING_PROVIDERS: AiProvider[] = ["openai", "unigpt", "custom"];

function readAiDraft(cfg: Record<string, unknown>): AiConfigDraft {
  const ai = (cfg.ai as Record<string, unknown> | undefined) ?? {};
  const llm = (ai.llm as Partial<AiModelSelection> | undefined) ?? {};
  const embedding = (ai.embedding as Partial<AiModelSelection> | undefined) ?? {};
  const rawDim = embedding.dimensions;
  const dimensions =
    typeof rawDim === "number" && Number.isFinite(rawDim) && rawDim > 0
      ? Math.floor(rawDim)
      : null;
  return {
    llm: {
      provider: (llm.provider as AiProvider | null | undefined) ?? null,
      model: (llm.model as string | null | undefined) ?? null,
    },
    embedding: {
      provider: (embedding.provider as AiProvider | null | undefined) ?? null,
      model: (embedding.model as string | null | undefined) ?? null,
      dimensions,
    },
  };
}

export default function ModuleDetailPage() {
  const router = useRouter();
  const { moduleId } = useParams<{ moduleId: string }>();
  const { data: cfg } = useModuleConfig(moduleId);
  const { data: manifest, isLoading: manifestLoading, isError: manifestError } =
    useModuleManifest(moduleId);
  const uninstall = useUninstallModule();
  const update = useUpdateModuleConfig();
  const recreateIndex = useRecreateModuleIndex(moduleId);

  const schema = (manifest?.config_schema as ConfigSchema | undefined) ?? null;
  const properties = schema?.properties ?? {};
  const hasSchema = Object.keys(properties).length > 0;

  const aiManifest: AiModelsManifest | null = manifest?.ai_models ?? null;
  const hasAiModels = Boolean(aiManifest && (aiManifest.llm || aiManifest.embedding));

  // Optional uploadable-model store (e.g. cv4cdd). Selection is persisted into
  // the module config under `config_key` (default "model").
  const modelStore: ModelStoreManifest | null = manifest?.model_store ?? null;
  const modelConfigKey = modelStore?.config_key ?? "model";
  // Self-hosted modules own their OpenAI key (isolated from Settings → AI) and
  // render the module's own card instead of the platform-keyed picker.
  const selfHosted = Boolean(aiManifest?.self_hosted);

  const [enabled, setEnabled] = useState<boolean>(true);
  useEffect(() => {
    if (cfg !== undefined) setEnabled(cfg.enabled);
  }, [cfg]);

  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [aiDraft, setAiDraft] = useState<AiConfigDraft>(EMPTY_AI_DRAFT);
  const [moduleAiDraft, setModuleAiDraft] = useState<ModuleAiDraft>(EMPTY_MODULE_AI_DRAFT);
  const [savedApiKey, setSavedApiKey] = useState<string>("");
  useEffect(() => {
    if (cfg !== undefined) {
      const c = cfg.config ?? {};
      setDraft(c);
      setAiDraft(readAiDraft(c));
      const mAi = readModuleAiDraft(c);
      setModuleAiDraft(mAi);
      setSavedApiKey(mAi.api_key);
    }
  }, [cfg]);

  const m = manifest
    ? {
        id: manifest.id as string,
        name: manifest.name as string,
        version: manifest.version as string,
        category: manifest.category as string,
        description: (manifest.description as string | null) ?? null,
        provides: (manifest.provides as string[]) ?? [],
        consumes: (manifest.consumes as string[]) ?? [],
      }
    : null;

  const composeConfig = (base: Record<string, unknown>): Record<string, unknown> => {
    if (!hasAiModels) return base;
    if (selfHosted) {
      return {
        ...base,
        ai: {
          api_key: moduleAiDraft.api_key,
          llm_model: moduleAiDraft.llm_model,
          embedding_model: moduleAiDraft.embedding_model,
          embedding_dimensions: moduleAiDraft.embedding_dimensions,
        },
      };
    }
    return { ...base, ai: { llm: aiDraft.llm, embedding: aiDraft.embedding } };
  };

  const onToggleEnabled = async (val: boolean) => {
    setEnabled(val);
    try {
      await update.mutateAsync({
        id: moduleId,
        config: composeConfig(draft),
        enabled: val,
      });
      toast.success(val ? `${m?.name ?? moduleId} enabled` : `${m?.name ?? moduleId} disabled`);
    } catch {
      setEnabled(!val);
      toastError("Failed to update module");
    }
  };

  const onSaveConfig = async () => {
    try {
      await update.mutateAsync({
        id: moduleId,
        config: composeConfig(draft),
        enabled,
      });
      toast.success("Configuration saved");
      if (selfHosted) setSavedApiKey(moduleAiDraft.api_key);
    } catch {
      toastError("Failed to save configuration");
    }
  };

  const onSelectModel = async (name: string) => {
    const next = { ...draft, [modelConfigKey]: name };
    setDraft(next);
    await update.mutateAsync({
      id: moduleId,
      config: composeConfig(next),
      enabled,
    });
  };

  const onUninstall = async () => {
    try {
      await uninstall.mutateAsync(moduleId);
      toast.success(`Uninstalled ${m?.name ?? moduleId}`);
      router.push("/modules");
    } catch (err: unknown) {
      toastError(`Uninstall failed: ${(err as Error).message}`);
    }
  };

  if (manifestLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (manifestError || !m) {
    return (
      <EmptyState
        icon={FileBox}
        title={`Module "${moduleId}" not found`}
        description="It may have been uninstalled or failed to load."
      />
    );
  }

  const cfgLoading = cfg === undefined;

  return (
    <div className="space-y-4">
      <Button asChild variant="ghost" size="sm" className="cursor-pointer -ml-2 gap-1">
        <Link href="/modules">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to modules
        </Link>
      </Button>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <CardTitle className="text-base flex flex-wrap items-center gap-2">
              {m.name}
              <Badge variant="secondary" className="h-5 px-2 py-0 text-[9px] font-medium uppercase tracking-wide">
                {m.category.replace("_", " ")}
              </Badge>
              <span className="text-xs font-normal text-muted-foreground">{m.version}</span>
            </CardTitle>
            <div className="flex items-center gap-2 shrink-0">
              {cfgLoading ? (
                <Skeleton className="h-6 w-24" />
              ) : (
                <>
                  <Label htmlFor="module-enabled" className="text-sm">
                    {enabled ? "Enabled" : "Disabled"}
                  </Label>
                  <Switch
                    id="module-enabled"
                    checked={enabled}
                    onCheckedChange={onToggleEnabled}
                    disabled={update.isPending}
                  />
                </>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {m.description && <p className="text-muted-foreground">{m.description}</p>}
          <Section label="Provides" items={m.provides.length ? m.provides : ["—"]} />
          <Section label="Consumes" items={m.consumes.length ? m.consumes : ["—"]} />
        </CardContent>
      </Card>

      {hasAiModels && aiManifest && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">AI models</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {cfgLoading ? (
              <Skeleton className="h-20 w-full" />
            ) : selfHosted ? (
              <ModuleOpenAiCard
                moduleId={moduleId}
                savedApiKey={savedApiKey}
                llmSlot={aiManifest.llm}
                embeddingSlot={aiManifest.embedding}
                value={moduleAiDraft}
                onChange={setModuleAiDraft}
              />
            ) : (
              <>
                <AiKeysBanner />
                {aiManifest.llm && (
                  <AiModelPicker
                    title={aiManifest.llm.title}
                    description={aiManifest.llm.description}
                    value={aiDraft.llm}
                    onChange={(next) => setAiDraft((d) => ({ ...d, llm: next }))}
                  />
                )}
                {aiManifest.embedding && (
                  <AiModelPicker
                    title={aiManifest.embedding.title}
                    description={aiManifest.embedding.description}
                    value={aiDraft.embedding}
                    onChange={(next) => setAiDraft((d) => ({ ...d, embedding: next }))}
                    allowProviders={EMBEDDING_PROVIDERS}
                    preferEmbeddingModels
                    showDimensions
                  />
                )}
              </>
            )}
            <Separator />
            <div className="flex items-center justify-between gap-2">
              {aiManifest.embedding ? (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      className="cursor-pointer text-destructive hover:bg-destructive/10"
                      disabled={recreateIndex.isPending}
                    >
                      Recreate Pinecone index
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Recreate the Pinecone index?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This deletes the index and creates a fresh one using the dimension
                        currently configured above. <strong>All previously ingested
                        document vectors will be lost</strong> - you&apos;ll need to re-run
                        ingestion afterwards. Save any pending AI-model changes first.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel className="cursor-pointer">Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={async () => {
                          try {
                            const res = await recreateIndex.mutateAsync();
                            toast.success(
                              `Recreated "${res.index_name}" (dim ${res.dimension})`,
                            );
                          } catch (e) {
                            toastError(
                              `Failed to recreate index: ${(e as Error).message}`,
                            );
                          }
                        }}
                        className="cursor-pointer bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Delete & recreate
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              ) : (
                <span />
              )}
              <Button
                size="sm"
                onClick={onSaveConfig}
                disabled={update.isPending || cfgLoading}
                className="cursor-pointer"
              >
                Save AI models
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {modelStore && !cfgLoading && (
        <ModelStoreCard
          moduleId={moduleId}
          store={modelStore}
          selected={
            typeof draft[modelConfigKey] === "string"
              ? (draft[modelConfigKey] as string)
              : null
          }
          onSelect={onSelectModel}
          saving={update.isPending}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {hasSchema || hasAiModels ? (
            cfgLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : (
              <>
                {hasSchema && (
                  <ConfigForm
                    properties={properties}
                    values={draft}
                    onChange={(key, val) => setDraft((d) => ({ ...d, [key]: val }))}
                  />
                )}
                {hasSchema && <Separator />}
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    onClick={onSaveConfig}
                    disabled={update.isPending}
                    className="cursor-pointer"
                  >
                    Save configuration
                  </Button>
                </div>
              </>
            )
          ) : (
            <p className="text-xs text-muted-foreground">
              This module has no configurable parameters.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Logs</CardTitle>
        </CardHeader>
        <CardContent>
          <ModuleLogsTail moduleId={m.id} />
        </CardContent>
      </Card>

      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="text-base">Danger zone</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Removes the module from your account. Default modules can be brought
            back with <span className="font-medium text-foreground">Restore defaults</span>;
            custom uploads are deleted from disk once no one else has them installed.
          </p>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                className="cursor-pointer gap-2 text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Uninstall
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Uninstall {m.name}?</AlertDialogTitle>
                <AlertDialogDescription>
                  This removes <code>{m.id}</code> from your installed modules and
                  unmounts it for you. Your event-log data and other users are
                  unaffected.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="cursor-pointer">Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={onUninstall}
                  className="cursor-pointer bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Uninstall
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </div>
  );
}

function ConfigForm({
  properties,
  values,
  onChange,
}: {
  properties: Record<string, PropSchema>;
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}) {
  const groups = new Map<string, [string, PropSchema][]>();
  for (const [key, prop] of Object.entries(properties)) {
    const group = prop.ui?.group ?? "";
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push([key, prop]);
  }

  return (
    <div className="space-y-6">
      {Array.from(groups.entries()).map(([group, fields]) => (
        <div key={group} className="space-y-4">
          {group && (
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {group}
            </p>
          )}
          {fields.map(([key, prop]) => (
            <ConfigField
              key={key}
              fieldKey={key}
              prop={prop}
              value={values[key] ?? prop.default ?? ""}
              onChange={(v) => onChange(key, v)}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function ConfigField({
  fieldKey,
  prop,
  value,
  onChange,
}: {
  fieldKey: string;
  prop: PropSchema;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const widget = prop.ui?.widget;
  const isSelect = widget === "select" || (prop.enum && prop.enum.length > 0);
  const isSlider = widget === "slider" && prop.type === "number";

  return (
    <div className="space-y-1.5">
      <Label htmlFor={fieldKey} className="text-sm">
        {prop.title ?? fieldKey}
      </Label>
      {prop.description && (
        <p className="text-xs text-muted-foreground">{prop.description}</p>
      )}

      {isSelect && prop.enum ? (
        <Select value={String(value)} onValueChange={(v) => onChange(v)}>
          <SelectTrigger id={fieldKey} className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {prop.enum.map((opt) => (
              <SelectItem key={opt} value={opt}>
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : isSlider ? (
        <div className="flex max-w-xl items-center gap-3 pt-1">
          <Slider
            id={fieldKey}
            min={prop.minimum ?? 0}
            max={prop.maximum ?? 1}
            step={prop.step ?? 0.01}
            value={[Number(value)]}
            onValueChange={([v]) => onChange(v)}
            className="flex-1"
          />
          <span className="tabular-nums text-sm text-muted-foreground w-12 shrink-0">
            {Number(value).toFixed(
              (prop.step ?? 1) < 1
                ? String(prop.step ?? 0.01).split(".")[1]?.length ?? 2
                : 0,
            )}
          </span>
        </div>
      ) : (
        <Input
          id={fieldKey}
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
          placeholder={String(prop.default ?? "")}
          className="max-w-lg font-mono text-xs"
        />
      )}
    </div>
  );
}

function Section({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {items.map((s) => (
          <code key={s} className="rounded bg-muted px-1.5 py-0.5 text-[11px]">
            {s}
          </code>
        ))}
      </div>
    </div>
  );
}
