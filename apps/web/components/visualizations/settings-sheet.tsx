"use client";

import { useEffect, useState } from "react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  useGeneralSettings,
  useGeneralSettingsSetter,
  useModuleConfig,
  useModuleConfigSchema,
  useResetGeneralSettings,
  useUpdateModuleConfig,
} from "./discovery-settings-context";
import {
  DEFAULT_GENERAL,
  type EdgeRouting,
  type FrequencyDisplayMode,
  type LayoutDirection,
  type Theme,
} from "@/lib/stores/visualization-settings";

interface SettingsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsSheet({ open, onOpenChange }: SettingsSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md flex flex-col gap-0 p-0">
        <SheetHeader className="border-b">
          <SheetTitle>Visualisation settings</SheetTitle>
          <SheetDescription>
            General appearance and per-module knobs. Render-only changes apply instantly; compute
            settings re-run discovery.
          </SheetDescription>
        </SheetHeader>
        <Tabs defaultValue="general" className="flex flex-1 flex-col min-h-0">
          <TabsList className="mx-4 mt-4 self-start">
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="module">Module</TabsTrigger>
          </TabsList>
          <TabsContent value="general" className="flex-1 overflow-y-auto px-4 py-4">
            <GeneralSettingsForm />
          </TabsContent>
          <TabsContent value="module" className="flex-1 overflow-y-auto px-4 py-4">
            <ModuleSettingsForm onSaved={() => onOpenChange(false)} />
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

// --------------------------------------------------------------------------
// General tab
// --------------------------------------------------------------------------

function GeneralSettingsForm() {
  const settings = useGeneralSettings();
  const set = useGeneralSettingsSetter();
  const reset = useResetGeneralSettings();

  return (
    <div className="space-y-6">
      <SettingGroup
        title="Layout"
        description="Direction and spacing of auto-laid graphs."
      >
        <FieldRow label="Direction">
          <RadioGroup
            value={settings.layoutDirection}
            onValueChange={(v) => set({ layoutDirection: v as LayoutDirection })}
            className="flex gap-3"
          >
            {(["LR", "TB", "RL", "BT"] as LayoutDirection[]).map((d) => (
              <Label
                key={d}
                className="flex items-center gap-1.5 text-xs cursor-pointer"
                htmlFor={`dir-${d}`}
              >
                <RadioGroupItem value={d} id={`dir-${d}`} />
                {d}
              </Label>
            ))}
          </RadioGroup>
        </FieldRow>
        <FieldRow label="Edge routing">
          <Select
            value={settings.edgeRouting}
            onValueChange={(v) => set({ edgeRouting: v as EdgeRouting })}
          >
            <SelectTrigger className="h-8 w-44 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="orthogonal">Orthogonal</SelectItem>
              <SelectItem value="spline">Spline</SelectItem>
              <SelectItem value="straight">Straight</SelectItem>
            </SelectContent>
          </Select>
        </FieldRow>
      </SettingGroup>

      <Separator />

      <SettingGroup title="Display" description="Chrome and labels.">
        <FieldRow label="Show minimap">
          <Switch
            checked={settings.showMinimap}
            onCheckedChange={(v) => set({ showMinimap: v })}
          />
        </FieldRow>
        <FieldRow label="Show grid background">
          <Switch
            checked={settings.showGrid}
            onCheckedChange={(v) => set({ showGrid: v })}
          />
        </FieldRow>
        <FieldRow label="Node label max length">
          <div className="flex items-center gap-3 w-44">
            <Slider
              value={[settings.nodeLabelMaxLength]}
              min={6}
              max={64}
              step={2}
              onValueChange={(v) => set({ nodeLabelMaxLength: v[0] ?? 32 })}
            />
            <span className="text-xs tabular-nums w-6 text-right text-muted-foreground">
              {settings.nodeLabelMaxLength}
            </span>
          </div>
        </FieldRow>
        <FieldRow label="Frequency display">
          <Select
            value={settings.frequencyDisplayMode}
            onValueChange={(v) => set({ frequencyDisplayMode: v as FrequencyDisplayMode })}
          >
            <SelectTrigger className="h-8 w-44 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="count">Count</SelectItem>
              <SelectItem value="ratio">Ratio</SelectItem>
              <SelectItem value="per-case">Per case</SelectItem>
            </SelectContent>
          </Select>
        </FieldRow>
        <FieldRow label="Color intensity">
          <div className="flex items-center gap-3 w-44">
            <Slider
              value={[settings.colorIntensity]}
              min={0}
              max={1}
              step={0.05}
              onValueChange={(v) => set({ colorIntensity: v[0] ?? 0.6 })}
            />
            <span className="text-xs tabular-nums w-10 text-right text-muted-foreground">
              {settings.colorIntensity.toFixed(2)}
            </span>
          </div>
        </FieldRow>
        <FieldRow label="Theme">
          <Select value={settings.theme} onValueChange={(v) => set({ theme: v as Theme })}>
            <SelectTrigger className="h-8 w-44 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">Default</SelectItem>
              <SelectItem value="monochrome">Monochrome</SelectItem>
              <SelectItem value="colorblind">Colorblind-safe</SelectItem>
            </SelectContent>
          </Select>
        </FieldRow>
      </SettingGroup>

      <Separator />

      <div className="flex justify-end">
        <Button variant="outline" size="sm" className="cursor-pointer" onClick={reset}>
          Reset to defaults
        </Button>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------
// Module tab — generic form driven by manifest config_schema
// --------------------------------------------------------------------------

interface SchemaProperty {
  type: "number" | "boolean" | "string" | "enum";
  title?: string;
  description?: string;
  minimum?: number;
  maximum?: number;
  step?: number;
  default?: unknown;
  enum?: string[];
  ui?: {
    widget?: "slider" | "switch" | "select" | "radio";
    group?: "general" | "viz";
    affects?: "compute" | "render";
  };
}

interface ConfigSchema {
  properties?: Record<string, SchemaProperty>;
}

function ModuleSettingsForm({ onSaved }: { onSaved: () => void }) {
  const { data: schema, isLoading: schemaLoading } = useModuleConfigSchema();
  const { data: stored, isLoading: configLoading } = useModuleConfig();
  const update = useUpdateModuleConfig();

  const properties = (schema as ConfigSchema | undefined)?.properties ?? {};
  const [draft, setDraft] = useState<Record<string, unknown>>({});

  useEffect(() => {
    if (stored) setDraft({ ...stored.config });
  }, [stored]);

  if (schemaLoading || configLoading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  const entries = Object.entries(properties);
  if (entries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        This module exposes no configurable settings.
      </p>
    );
  }

  const onSave = async () => {
    await update.mutateAsync({
      config: draft,
      enabled: stored?.enabled ?? true,
    });
    onSaved();
  };

  const onResetDefaults = () => {
    const fresh: Record<string, unknown> = {};
    for (const [key, prop] of entries) {
      if (prop.default !== undefined) fresh[key] = prop.default;
    }
    setDraft(fresh);
  };

  return (
    <div className="space-y-6">
      {entries.map(([key, prop]) => {
        const value = draft[key] ?? prop.default;
        return (
          <SchemaField
            key={key}
            propKey={key}
            prop={prop}
            value={value}
            onChange={(v) => setDraft((d) => ({ ...d, [key]: v }))}
          />
        );
      })}

      <Separator />

      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" className="cursor-pointer" onClick={onResetDefaults}>
          Reset to defaults
        </Button>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="cursor-pointer"
            onClick={onSaved}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            className="cursor-pointer"
            onClick={onSave}
            disabled={update.isPending}
          >
            {update.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function SchemaField({
  propKey,
  prop,
  value,
  onChange,
}: {
  propKey: string;
  prop: SchemaProperty;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const widget = prop.ui?.widget ?? defaultWidgetForType(prop);
  const compute = prop.ui?.affects === "compute";

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <Label className="text-sm font-medium">{prop.title ?? propKey}</Label>
        {compute && (
          <span className="text-[10px] uppercase tracking-wide text-amber-600 dark:text-amber-400">
            recomputes
          </span>
        )}
      </div>
      {prop.description && (
        <p className="text-xs text-muted-foreground">{prop.description}</p>
      )}
      <div>
        {widget === "slider" && prop.type === "number" && (
          <div className="flex items-center gap-3">
            <Slider
              value={[Number(value ?? prop.default ?? 0)]}
              min={prop.minimum ?? 0}
              max={prop.maximum ?? 1}
              step={prop.step ?? 0.05}
              onValueChange={(v) => onChange(v[0])}
            />
            <span className="text-xs tabular-nums w-12 text-right text-muted-foreground">
              {Number(value ?? prop.default ?? 0).toFixed(2)}
            </span>
          </div>
        )}
        {widget === "switch" && prop.type === "boolean" && (
          <Switch
            checked={Boolean(value)}
            onCheckedChange={(v) => onChange(v)}
          />
        )}
        {widget === "select" && (prop.type === "enum" || prop.type === "string") && (
          <Select value={String(value ?? "")} onValueChange={(v) => onChange(v)}>
            <SelectTrigger className="h-8 w-full text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(prop.enum ?? []).map((opt) => (
                <SelectItem key={opt} value={opt}>
                  {opt}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {widget === "radio" && prop.enum && (
          <RadioGroup
            value={String(value ?? "")}
            onValueChange={(v) => onChange(v)}
            className="flex flex-wrap gap-3"
          >
            {prop.enum.map((opt) => (
              <Label
                key={opt}
                className="flex items-center gap-1.5 text-xs cursor-pointer"
                htmlFor={`${propKey}-${opt}`}
              >
                <RadioGroupItem value={opt} id={`${propKey}-${opt}`} />
                {opt}
              </Label>
            ))}
          </RadioGroup>
        )}
      </div>
    </div>
  );
}

function defaultWidgetForType(prop: SchemaProperty): "slider" | "switch" | "select" | "radio" {
  if (prop.type === "boolean") return "switch";
  if (prop.type === "number") return "slider";
  if (prop.type === "enum") return "select";
  return "select";
}

// --------------------------------------------------------------------------
// Layout helpers
// --------------------------------------------------------------------------

function SettingGroup({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="space-y-0.5">
        <h3 className="text-sm font-medium leading-none">{title}</h3>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <Label className="text-xs text-muted-foreground font-normal">{label}</Label>
      {children}
    </div>
  );
}

// Re-export defaults for diagnostics / story-style usage.
export { DEFAULT_GENERAL };
