"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  HardDriveUpload,
  Loader2,
  Lock,
  ShieldAlert,
  Trash2,
  Unlock,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import {
  ModuleConfigForm,
  type ConfigSchema,
} from "@/components/modules/module-config-form";
import { AiSettingsEditor } from "@/components/ai/ai-settings-editor";
import { UploadProgress } from "@/components/settings/upload-progress";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import type { ControlItem } from "@/lib/api-types";
import {
  useAdminAiConfig,
  useFetchAdminProviderModels,
  usePricingCatalog,
  useUpdateAdminAiConfig,
} from "@/lib/ai-queries";
import { useControlItems, useSetControl } from "@/lib/control-queries";
import {
  useDeleteModuleModel,
  useModuleModels,
  useUploadModuleModel,
} from "@/lib/queries";
import { toastError } from "@/lib/toast";

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export default function AdminControlsPage() {
  const settings = useControlItems("setting");
  const modules = useControlItems("module");

  const forbidden =
    (settings.error instanceof ApiError && settings.error.status === 403) ||
    (modules.error instanceof ApiError && modules.error.status === 403);

  if (forbidden) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          Controls require the <code>admin</code> role. Ask an administrator to
          grant it in Keycloak (Realm roles → admin).
        </span>
      </div>
    );
  }

  // The CV4CDD detection model is a `setting`-scope control, but it belongs with
  // the module (upload + pin + lock) rather than buried in the generic server
  // settings list. Pull it out here and render it inside the Modules section,
  // attached to the cv4cdd card.
  const settingItems = settings.data?.items ?? [];
  const modelSetting = settingItems.find((i) => i.key === "cv4cdd.model");
  const serverSettings = settingItems.filter((i) => i.key !== "cv4cdd.model");

  const moduleItems = modules.data?.items ?? [];
  const hasCv4cdd = moduleItems.some((i) => i.key === "cv4cdd");

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold">Server settings</h2>
          <p className="text-xs text-muted-foreground">
            Lock a setting to apply one shared, admin-set value to every user.
            Unlocked, each user keeps their own value.
          </p>
        </div>
        {settings.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : settings.isError ? (
          <p className="text-xs text-destructive">Failed to load settings.</p>
        ) : (
          serverSettings.map((item) => <SettingRow key={item.key} item={item} />)
        )}
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold">Modules</h2>
          <p className="text-xs text-muted-foreground">
            Lock a module to set one shared configuration used by every user who
            has it installed.
          </p>
        </div>
        {modules.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : modules.isError ? (
          <p className="text-xs text-destructive">Failed to load modules.</p>
        ) : (
          <>
            {moduleItems.map((item) =>
              item.key === "cv4cdd" ? (
                <div key={item.key} className="space-y-3">
                  {modelSetting && <Cv4cddModelManager item={modelSetting} />}
                  <ModuleRow item={item} />
                </div>
              ) : (
                <ModuleRow key={item.key} item={item} />
              ),
            )}
            {/* cv4cdd installed by nobody yet, but the shared-model pin still
                lives here so an admin can manage it once it's installed. */}
            {!hasCv4cdd && modelSetting && <Cv4cddModelManager item={modelSetting} />}
            {moduleItems.length === 0 && !modelSetting && (
              <p className="text-xs text-muted-foreground">No modules installed.</p>
            )}
          </>
        )}
      </section>
    </div>
  );
}

// ── Generic row shell ───────────────────────────────────────────────────────

function ControlHeader({
  item,
  locked,
  onToggle,
  saving,
  collapsible,
  open,
}: {
  item: ControlItem;
  locked: boolean;
  onToggle: (next: boolean) => void;
  saving: boolean;
  collapsible: boolean;
  open: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex min-w-0 items-start gap-2">
        {collapsible && (
          <ChevronDown
            className={cn(
              "mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform",
              open ? "" : "-rotate-90",
            )}
          />
        )}
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2 text-sm">
            {locked ? (
              <Lock className="h-3.5 w-3.5 text-primary" />
            ) : (
              <Unlock className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            {item.label}
          </CardTitle>
          {item.description && (
            <p className="mt-1 text-xs text-muted-foreground">{item.description}</p>
          )}
        </div>
      </div>
      {/* The lock control is interactive; keep its clicks from toggling the card. */}
      <div
        className="flex shrink-0 items-center gap-2"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="text-xs text-muted-foreground">
          {locked ? "Admin-controlled" : "Per-user"}
        </span>
        <Switch checked={locked} onCheckedChange={onToggle} disabled={saving} />
      </div>
    </div>
  );
}

/** A control card whose whole surface (header + padding) toggles open/closed
 *  once locked. The body is only present when expanded, and stops click
 *  propagation so editing inside it never collapses the card; the lock Switch
 *  does the same in the header. Defaults to collapsed. */
function CollapsibleControlCard({
  item,
  locked,
  onToggleLock,
  saving,
  contentClassName,
  children,
}: {
  item: ControlItem;
  locked: boolean;
  onToggleLock: (next: boolean) => void;
  saving: boolean;
  contentClassName?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const collapsible = locked;
  const toggle = () => setOpen((o) => !o);
  // Keyboard toggle only when the card itself is focused, so Enter/Space inside
  // the body's inputs/switch don't bubble up and collapse it.
  const handleKey = (e: React.KeyboardEvent) => {
    if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      toggle();
    }
  };
  return (
    <Card
      className={cn(collapsible && "cursor-pointer select-none")}
      role={collapsible ? "button" : undefined}
      tabIndex={collapsible ? 0 : undefined}
      aria-expanded={collapsible ? open : undefined}
      onClick={collapsible ? toggle : undefined}
      onKeyDown={collapsible ? handleKey : undefined}
    >
      <CardHeader>
        <ControlHeader
          item={item}
          locked={locked}
          onToggle={onToggleLock}
          saving={saving}
          collapsible={collapsible}
          open={open}
        />
      </CardHeader>
      {locked && open && (
        <CardContent
          className={cn("cursor-auto select-text", contentClassName)}
          onClick={(e) => e.stopPropagation()}
        >
          {children}
        </CardContent>
      )}
    </Card>
  );
}

// ── Settings rows ───────────────────────────────────────────────────────────

function SettingRow({ item }: { item: ControlItem }) {
  const set = useSetControl("setting");
  const locked = item.control_mode === "admin";

  const onToggle = async (next: boolean) => {
    try {
      await set.mutateAsync({
        key: item.key,
        control_mode: next ? "admin" : "user",
        // Locking keeps any previously stored admin value (server merges); the
        // per-key editor below is how the admin actually sets it.
        admin_value: next ? (item.admin_value ?? undefined) : undefined,
      });
    } catch (e) {
      toastError(`Failed: ${(e as Error).message}`);
    }
  };

  return (
    <CollapsibleControlCard
      item={item}
      locked={locked}
      onToggleLock={onToggle}
      saving={set.isPending}
    >
      {item.key === "ai.config" ? (
        <AiAdminEditor />
      ) : item.key === "worker_concurrency" ? (
        <WorkerConcurrencyEditor item={item} />
      ) : item.key === "analytics.config" ? (
        <AnalyticsEditor item={item} />
      ) : (
        <p className="text-xs text-muted-foreground">No editor for this setting.</p>
      )}
    </CollapsibleControlCard>
  );
}

function AiAdminEditor() {
  const { data: stored, isLoading, isError } = useAdminAiConfig();
  const update = useUpdateAdminAiConfig();
  const fetchModels = useFetchAdminProviderModels();
  const { data: pricing } = usePricingCatalog();

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (isError || !stored) {
    return <p className="text-xs text-destructive">Failed to load shared AI settings.</p>;
  }

  // Same rich card editor as Settings → AI, but bound to the shared admin value:
  // provider picker, key + Fetch models, model + classifier dropdowns. Saving
  // locks ai.config to admin control (handled server-side).
  return (
    <AiSettingsEditor
      variant="admin"
      stored={stored}
      pricing={pricing}
      saving={update.isPending}
      onSave={(cfg) => update.mutateAsync(cfg)}
      onFetchModels={(provider) => fetchModels.mutateAsync(provider)}
    />
  );
}

function WorkerConcurrencyEditor({ item }: { item: ControlItem }) {
  const set = useSetControl("setting");
  const initial = typeof item.admin_value === "number" ? item.admin_value : 1;
  const [value, setValue] = useState(initial);
  useEffect(() => setValue(initial), [initial]);

  const onSave = async () => {
    try {
      await set.mutateAsync({
        key: "worker_concurrency",
        control_mode: "admin",
        admin_value: value,
      });
      toast.success("Worker concurrency applied");
    } catch (e) {
      toastError(`Save failed: ${(e as Error).message}`);
    }
  };

  return (
    <div className="flex items-end gap-3">
      <div className="space-y-1.5">
        <Label htmlFor="wc">Workers</Label>
        <Input
          id="wc"
          type="number"
          min={1}
          max={8}
          value={value}
          onChange={(e) => setValue(Number(e.target.value))}
          className="w-24"
        />
      </div>
      <Button size="sm" onClick={onSave} disabled={set.isPending} className="cursor-pointer gap-2">
        {set.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        Apply
      </Button>
    </div>
  );
}

function AnalyticsEditor({ item }: { item: ControlItem }) {
  const set = useSetControl("setting");
  const current =
    item.admin_value && typeof item.admin_value === "object"
      ? ((item.admin_value as { mode?: string }).mode ?? "on")
      : "on";
  const [mode, setMode] = useState(current);
  useEffect(() => setMode(current), [current]);

  const onSave = async () => {
    try {
      await set.mutateAsync({
        key: "analytics.config",
        control_mode: "admin",
        admin_value: { mode, enabled: mode !== "off" },
      });
      toast.success("Analytics policy saved");
    } catch (e) {
      toastError(`Save failed: ${(e as Error).message}`);
    }
  };

  return (
    <div className="flex items-end gap-3">
      <div className="space-y-1.5">
        <Label htmlFor="analytics-mode">Mode</Label>
        <Select value={mode} onValueChange={setMode}>
          <SelectTrigger id="analytics-mode" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="force">Force on (no opt-out)</SelectItem>
            <SelectItem value="on">On (opt-out allowed)</SelectItem>
            <SelectItem value="off">Off</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Button size="sm" onClick={onSave} disabled={set.isPending} className="cursor-pointer gap-2">
        {set.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        Apply
      </Button>
    </div>
  );
}

/** Full CV4CDD detection-model manager: upload (with progress), pick the shared
 *  model, lock it platform-wide. Lives in the Modules section attached to the
 *  cv4cdd card rather than in the generic server-settings list. The lock toggle
 *  + pin write the `cv4cdd.model` setting control; uploads/deletes hit the
 *  module's own `/models` route (platform-shared storage). */
function Cv4cddModelManager({ item }: { item: ControlItem }) {
  const set = useSetControl("setting");
  const modelsQ = useModuleModels("cv4cdd");
  const upload = useUploadModuleModel("cv4cdd");
  const remove = useDeleteModuleModel("cv4cdd");
  const fileRef = useRef<HTMLInputElement>(null);

  const locked = item.control_mode === "admin";
  const pinned = typeof item.admin_value === "string" ? item.admin_value : "";
  const [value, setValue] = useState(pinned);
  useEffect(() => setValue(pinned), [pinned]);

  const onToggleLock = async (next: boolean) => {
    try {
      await set.mutateAsync({
        key: "cv4cdd.model",
        control_mode: next ? "admin" : "user",
        // Locking keeps the current pin (or the in-progress selection); the
        // picker + Apply below is how the admin changes it.
        admin_value: next ? value || pinned || undefined : undefined,
      });
      toast.success(
        next
          ? "Detection model locked for all users"
          : "Detection model unlocked – each user picks their own",
      );
    } catch (e) {
      toastError(`Failed: ${(e as Error).message}`);
    }
  };

  const onApply = async () => {
    try {
      await set.mutateAsync({ key: "cv4cdd.model", control_mode: "admin", admin_value: value });
      toast.success("Shared detection model pinned");
    } catch (e) {
      toastError(`Save failed: ${(e as Error).message}`);
    }
  };

  const onFilePicked = async (file: File | undefined) => {
    if (!file) return;
    try {
      const res = await upload.mutateAsync(file);
      toast.success(`Installed model "${res.name}"`);
      // Nothing pinned yet? Preselect the first upload so Apply is one click.
      if (!value) setValue(res.name);
    } catch (e) {
      toastError(`Upload failed: ${(e as Error).message}`);
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const onDelete = async (name: string) => {
    try {
      await remove.mutateAsync(name);
      toast.success(`Deleted model "${name}"`);
    } catch (e) {
      toastError(`Delete failed: ${(e as Error).message}`);
    }
  };

  const notInstalled =
    modelsQ.isError && modelsQ.error instanceof ApiError && modelsQ.error.status === 404;
  const models = modelsQ.data?.models ?? [];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-sm">
              {locked ? (
                <Lock className="h-3.5 w-3.5 text-primary" />
              ) : (
                <Unlock className="h-3.5 w-3.5 text-muted-foreground" />
              )}
              CV4CDD detection model
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Upload and pin one shared detection model for every user. Unlocked,
              each user picks their own on the module&apos;s settings page.
            </p>
          </div>
          <div
            className="flex shrink-0 items-center gap-2"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="text-xs text-muted-foreground">
              {locked ? "Admin-controlled" : "Per-user"}
            </span>
            <Switch checked={locked} onCheckedChange={onToggleLock} disabled={set.isPending} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {notInstalled ? (
          <p className="text-xs text-muted-foreground">
            Install the CV4CDD module to manage its shared model.
          </p>
        ) : (
          <>
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <input
                  ref={fileRef}
                  type="file"
                  accept=".tar.zst"
                  className="hidden"
                  onChange={(e) => onFilePicked(e.target.files?.[0])}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="cursor-pointer gap-2"
                  disabled={upload.isPending}
                  onClick={() => fileRef.current?.click()}
                >
                  {upload.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <HardDriveUpload className="h-3.5 w-3.5" />
                  )}
                  {upload.isPending ? "Uploading…" : "Upload model"}
                </Button>
                <span className="text-xs text-muted-foreground">
                  Accepts <code className="rounded bg-muted px-1 py-0.5">.tar.zst</code> ·
                  shared platform-wide
                </span>
              </div>
              <UploadProgress isPending={upload.isPending} progress={upload.progress} />
            </div>

            {modelsQ.isLoading ? (
              <Skeleton className="h-20 w-full" />
            ) : models.length === 0 ? (
              <p className="rounded-md border border-dashed py-6 text-center text-xs text-muted-foreground">
                No models installed yet. Upload a .tar.zst archive to get started.
              </p>
            ) : (
              <RadioGroup
                value={value || undefined}
                onValueChange={setValue}
                disabled={!locked}
                className="gap-2"
              >
                {models.map((m) => (
                  <div
                    key={m.name}
                    className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
                  >
                    <div className="flex items-center gap-3">
                      <RadioGroupItem id={`pin-${m.name}`} value={m.name} disabled={!locked} />
                      <Label
                        htmlFor={`pin-${m.name}`}
                        className="cursor-pointer font-mono text-xs"
                      >
                        {m.name}
                      </Label>
                      {m.active && (
                        <Badge variant="secondary" className="h-5 px-1.5 py-0 text-[10px]">
                          in use
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="tabular-nums text-[11px] text-muted-foreground">
                        {formatBytes(m.size_bytes)}
                      </span>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 cursor-pointer text-muted-foreground hover:text-destructive"
                            disabled={remove.isPending}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete model “{m.name}”?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This removes the model from disk for{" "}
                              <strong>every account on the platform</strong>. Anyone
                              currently using it will need to pick another model.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel className="cursor-pointer">Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => onDelete(m.name)}
                              className="cursor-pointer bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            >
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                ))}
              </RadioGroup>
            )}

            {locked && models.length > 0 && (
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  Selected model applies to every user.
                </p>
                <Button
                  size="sm"
                  onClick={onApply}
                  disabled={set.isPending || !value || value === pinned}
                  className="cursor-pointer gap-2"
                >
                  {set.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Apply
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── Module rows ─────────────────────────────────────────────────────────────

function ModuleRow({ item }: { item: ControlItem }) {
  const set = useSetControl("module");
  const locked = item.control_mode === "admin";
  const schema = (item.config_schema as ConfigSchema | null) ?? null;
  const properties = useMemo(() => schema?.properties ?? {}, [schema]);
  const hasSchema = Object.keys(properties).length > 0;

  const initial = useMemo(
    () =>
      item.admin_value && typeof item.admin_value === "object"
        ? (item.admin_value as Record<string, unknown>)
        : {},
    [item.admin_value],
  );
  const [draft, setDraft] = useState<Record<string, unknown>>(initial);
  useEffect(() => setDraft(initial), [initial]);

  const onToggle = async (next: boolean) => {
    try {
      await set.mutateAsync({
        key: item.key,
        control_mode: next ? "admin" : "user",
        admin_value: next ? draft : undefined,
      });
    } catch (e) {
      toastError(`Failed: ${(e as Error).message}`);
    }
  };

  const onSave = async () => {
    try {
      await set.mutateAsync({ key: item.key, control_mode: "admin", admin_value: draft });
      toast.success(`${item.label} configuration saved`);
    } catch (e) {
      toastError(`Save failed: ${(e as Error).message}`);
    }
  };

  return (
    <CollapsibleControlCard
      item={item}
      locked={locked}
      onToggleLock={onToggle}
      saving={set.isPending}
      contentClassName="space-y-4"
    >
      {hasSchema ? (
        <ModuleConfigForm
          properties={properties}
          values={draft}
          onChange={(key, val) => setDraft((d) => ({ ...d, [key]: val }))}
        />
      ) : (
        <p className="text-xs text-muted-foreground">
          This module has no configurable parameters; locking simply pins its
          empty config for all users.
        </p>
      )}
      {hasSchema && (
        <div className="flex justify-end">
          <Button
            size="sm"
            onClick={onSave}
            disabled={set.isPending}
            className="cursor-pointer gap-2"
          >
            {set.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Save shared configuration
          </Button>
        </div>
      )}
    </CollapsibleControlCard>
  );
}
