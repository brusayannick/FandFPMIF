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
import {
  useModules,
  useModuleConfig,
  useModuleManifest,
  useUninstallModule,
  useUpdateModuleConfig,
} from "@/lib/queries";

// ---------------------------------------------------------------------------
// Types mirroring the manifest config_schema shape
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function ModuleDetailPage() {
  const router = useRouter();
  const { moduleId } = useParams<{ moduleId: string }>();
  const { data: modules, isLoading } = useModules(null);
  const { data: cfg } = useModuleConfig(moduleId);
  const { data: manifest } = useModuleManifest(moduleId);
  const uninstall = useUninstallModule();
  const update = useUpdateModuleConfig();

  const m = modules?.find((x) => x.id === moduleId);

  const schema = (manifest?.config_schema as ConfigSchema | undefined) ?? null;
  const properties = schema?.properties ?? {};
  const hasSchema = Object.keys(properties).length > 0;

  // Local enabled state — synced from server
  const [enabled, setEnabled] = useState<boolean>(true);
  useEffect(() => {
    if (cfg !== undefined) setEnabled(cfg.enabled);
  }, [cfg]);

  // Local config draft — synced from server
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  useEffect(() => {
    if (cfg !== undefined) setDraft(cfg.config ?? {});
  }, [cfg]);

  const onToggleEnabled = async (val: boolean) => {
    setEnabled(val);
    try {
      await update.mutateAsync({ id: moduleId, config: draft, enabled: val });
      toast.success(val ? `${m?.name ?? moduleId} enabled` : `${m?.name ?? moduleId} disabled`);
    } catch {
      setEnabled(!val);
      toastError("Failed to update module");
    }
  };

  const onSaveConfig = async () => {
    try {
      await update.mutateAsync({ id: moduleId, config: draft, enabled });
      toast.success("Configuration saved");
    } catch {
      toastError("Failed to save configuration");
    }
  };

  const onUninstall = async () => {
    try {
      await uninstall.mutateAsync(moduleId);
      toast.success(`Uninstalled ${m?.name ?? moduleId}`);
      router.push("/settings/modules");
    } catch (err: unknown) {
      toastError(`Uninstall failed: ${(err as Error).message}`);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (!m) {
    return (
      <EmptyState
        icon={FileBox}
        title={`Module "${moduleId}" not found`}
        description="It may have been uninstalled or failed to load."
      />
    );
  }

  return (
    <div className="space-y-4">
      <Button asChild variant="ghost" size="sm" className="cursor-pointer -ml-2 gap-1">
        <Link href="/settings/modules">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to modules
        </Link>
      </Button>

      {/* Info + enable toggle */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-4">
            <CardTitle className="text-base flex items-center gap-2">
              {m.name}
              <Badge variant="secondary" className="h-5 px-2 py-0 text-[9px] font-medium uppercase tracking-wide">
                {m.category.replace("_", " ")}
              </Badge>
              <span className="text-xs font-normal text-muted-foreground">{m.version}</span>
            </CardTitle>
            <div className="flex items-center gap-2 shrink-0">
              <Label htmlFor="module-enabled" className="text-sm">
                {enabled ? "Enabled" : "Disabled"}
              </Label>
              <Switch
                id="module-enabled"
                checked={enabled}
                onCheckedChange={onToggleEnabled}
                disabled={update.isPending}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {m.description && <p className="text-muted-foreground">{m.description}</p>}
          <Section label="Provides" items={m.provides.length ? m.provides : ["—"]} />
          <Section label="Consumes" items={m.consumes.length ? m.consumes : ["—"]} />
        </CardContent>
      </Card>

      {/* Configuration */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {hasSchema ? (
            <>
              <ConfigForm
                properties={properties}
                values={draft}
                onChange={(key, val) => setDraft((d) => ({ ...d, [key]: val }))}
              />
              <Separator />
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
          ) : (
            <p className="text-xs text-muted-foreground">
              This module has no configurable parameters.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Danger zone */}
      <Card className="border-destructive/30">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Danger zone</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Removes the module folder, its venv, and any cached results. The
            platform&apos;s own dependencies are unaffected.
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
                  This deletes <code>modules/{m.id}/</code> from disk and unmounts its
                  routes / event handlers. Your data and other modules are unaffected.
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

// ---------------------------------------------------------------------------
// Generic config form — renders fields from config_schema.properties
// ---------------------------------------------------------------------------
function ConfigForm({
  properties,
  values,
  onChange,
}: {
  properties: Record<string, PropSchema>;
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}) {
  // Group fields by ui.group (ungrouped fields get an implicit "" group)
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

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------
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
