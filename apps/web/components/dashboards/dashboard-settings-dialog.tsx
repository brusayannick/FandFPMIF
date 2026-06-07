"use client";

import { useState } from "react";
import { Settings, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { useDashboardFilter } from "@/components/dashboards/dashboard-filter";
import {
  GRANULARITY,
  type CanvasSettings,
  type CardChrome,
  type FilterPreset,
  type Granularity,
} from "@/lib/dashboard-queries";

const NONE = "__none__";

function newId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `preset-${Date.now()}`;
}

/**
 * The dashboard's board-level settings, gathered into one popup: canvas grid,
 * card appearance, and saved filters. Everything edits the board's
 * `CanvasSettings` (via `onChange`) so it rides the normal Save path and shows
 * up in view mode. Saved filters additionally apply *live* to the ephemeral
 * filter bar (through `useDashboardFilter`) so the change is visible immediately.
 */
export function DashboardSettingsDialog({
  settings,
  onChange,
}: {
  settings: CanvasSettings;
  onChange: (next: CanvasSettings) => void;
}) {
  const { columnFilters, setColumnFilters } = useDashboardFilter();
  const [newName, setNewName] = useState("");

  const setChrome = (patch: Partial<CardChrome>) =>
    onChange({ ...settings, chrome: { ...settings.chrome, ...patch } });

  // Selecting a saved filter marks it active (persisted) AND loads its filters
  // into the live bar so the board reflects it without leaving the dialog.
  const applyPreset = (id: string | null) => {
    const preset = id ? settings.presets.find((p) => p.id === id) : null;
    onChange({ ...settings, active_preset_id: preset ? preset.id : null });
    setColumnFilters(preset ? preset.filters : []);
  };

  const saveCurrentAsPreset = () => {
    const name = newName.trim();
    if (!name || columnFilters.length === 0) return;
    const preset: FilterPreset = { id: newId(), name, filters: columnFilters };
    onChange({
      ...settings,
      presets: [...settings.presets, preset],
      active_preset_id: preset.id,
    });
    setNewName("");
  };

  const deletePreset = (id: string) => {
    const wasActive = settings.active_preset_id === id;
    onChange({
      ...settings,
      presets: settings.presets.filter((p) => p.id !== id),
      active_preset_id: wasActive ? null : settings.active_preset_id,
    });
    if (wasActive) setColumnFilters([]);
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Settings className="mr-1.5 h-3.5 w-3.5" />
          Settings
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Dashboard settings</DialogTitle>
          <DialogDescription>
            Saved with the board and applied in view mode.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Grid granularity */}
          <section className="space-y-2">
            <Label className="text-xs font-medium text-muted-foreground">Grid</Label>
            <Select
              value={settings.granularity}
              onValueChange={(v) => onChange({ ...settings, granularity: v as Granularity })}
            >
              <SelectTrigger className="h-9 text-sm" aria-label="Canvas grid granularity">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(GRANULARITY) as Granularity[]).map((g) => (
                  <SelectItem key={g} value={g}>
                    <span className="flex flex-col">
                      <span>{GRANULARITY[g].label}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {GRANULARITY[g].description}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </section>

          <Separator />

          {/* Card appearance */}
          <section className="space-y-3">
            <Label className="text-xs font-medium text-muted-foreground">Card appearance</Label>
            <ChromeToggle
              label="Border"
              checked={settings.chrome.border}
              onCheckedChange={(v) => setChrome({ border: v })}
            />
          </section>

          <Separator />

          {/* Saved filters (persisted presets) */}
          <section className="space-y-3">
            <div className="space-y-0.5">
              <Label className="text-xs font-medium text-muted-foreground">Saved filters</Label>
              <p className="text-xs text-muted-foreground">
                Saved filter sets. The active one loads with the board.
              </p>
            </div>

            <RadioGroup
              value={settings.active_preset_id ?? NONE}
              onValueChange={(v) => applyPreset(v === NONE ? null : v)}
              className="gap-1.5"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value={NONE} id="seg-none" />
                <Label htmlFor="seg-none" className="text-sm font-normal">
                  No filter (full log)
                </Label>
              </div>
              {settings.presets.length > 0 && (
                <ScrollArea className="max-h-40">
                  <div className="space-y-1.5 pr-2">
                    {settings.presets.map((p) => (
                      <div key={p.id} className="flex items-center gap-2">
                        <RadioGroupItem value={p.id} id={`seg-${p.id}`} />
                        <Label
                          htmlFor={`seg-${p.id}`}
                          className="flex-1 truncate text-sm font-normal"
                        >
                          {p.name}
                        </Label>
                        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                          {p.filters.length} filter{p.filters.length === 1 ? "" : "s"}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`Delete ${p.name}`}
                          className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                          onClick={() => deletePreset(p.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </RadioGroup>

            <div className="flex items-center gap-2">
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Name this filter…"
                className="h-8 text-sm"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    saveCurrentAsPreset();
                  }
                }}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!newName.trim() || columnFilters.length === 0}
                onClick={saveCurrentAsPreset}
              >
                Save current
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {columnFilters.length === 0
                ? "Add filters in the bar above, then save them here."
                : `Captures the ${columnFilters.length} active filter${
                    columnFilters.length === 1 ? "" : "s"
                  } from the bar.`}
            </p>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ChromeToggle({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="space-y-0.5">
        <p className="text-sm">{label}</p>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}
