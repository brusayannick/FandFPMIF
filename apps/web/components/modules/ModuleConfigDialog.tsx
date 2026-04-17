"use client";

import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/lib/api-client";
import { z } from "zod";

const configResponseSchema = z.object({
  module_id: z.string(),
  config: z.record(z.string(), z.unknown()),
  enabled: z.boolean(),
  updated_at: z.string().nullable().optional(),
});

type ConfigResponse = z.infer<typeof configResponseSchema>;

interface JsonSchemaProperty {
  type?: string | string[];
  title?: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
}

interface JsonSchema {
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
}

interface ModuleConfigDialogProps {
  moduleId: string;
  displayName: string;
  configSchema: JsonSchema | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ModuleConfigDialog({
  moduleId,
  displayName,
  configSchema,
  open,
  onOpenChange,
}: ModuleConfigDialogProps) {
  const qc = useQueryClient();
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [enabled, setEnabled] = useState(true);

  const query = useQuery({
    queryKey: ["modules", moduleId, "config"],
    queryFn: async () => {
      const data = await api.get(`/modules/${moduleId}/config`);
      return configResponseSchema.parse(data);
    },
    enabled: open,
  });

  useEffect(() => {
    if (query.data) {
      setValues(query.data.config);
      setEnabled(query.data.enabled);
    }
  }, [query.data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const data = await api.put(`/modules/${moduleId}/config`, {
        config: values,
        enabled,
      });
      return configResponseSchema.parse(data);
    },
    onSuccess: () => {
      toast.success("Configuration saved");
      qc.invalidateQueries({ queryKey: ["modules", moduleId, "config"] });
      onOpenChange(false);
    },
    onError: (err) => {
      toast.error("Failed to save", {
        description:
          err instanceof ApiError
            ? ((err.body as { detail?: string } | null)?.detail ?? `HTTP ${err.status}`)
            : undefined,
      });
    },
  });

  const properties = configSchema?.properties ?? {};
  const hasSchema = Object.keys(properties).length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Configure — {displayName}</DialogTitle>
        </DialogHeader>

        {query.isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={20} className="animate-spin text-text-muted" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-md border bg-surface-2 px-3 py-2">
              <div>
                <div className="text-sm font-medium">Module enabled</div>
                <div className="text-xs text-text-muted">
                  Disabled modules still appear in the registry but won't run.
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={enabled}
                onClick={() => setEnabled((v) => !v)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                  enabled ? "bg-primary" : "bg-surface-offset"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-md transition-transform ${
                    enabled ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>

            {hasSchema ? (
              <div className="space-y-3">
                <div className="text-xs font-medium uppercase tracking-wider text-text-faint">
                  Parameters
                </div>
                {Object.entries(properties).map(([key, prop]) => (
                  <ConfigField
                    key={key}
                    fieldKey={key}
                    prop={prop}
                    value={values[key]}
                    onChange={(v) => setValues((prev) => ({ ...prev, [key]: v }))}
                  />
                ))}
              </div>
            ) : (
              <p className="text-sm text-text-muted">
                This module has no configurable parameters.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || query.isLoading}
          >
            {saveMutation.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConfigField({
  fieldKey,
  prop,
  value,
  onChange,
}: {
  fieldKey: string;
  prop: JsonSchemaProperty;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const label = prop.title ?? fieldKey.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const type = Array.isArray(prop.type) ? prop.type[0] : prop.type;

  if (prop.enum) {
    return (
      <div className="space-y-1.5">
        <Label className="text-xs">{label}</Label>
        {prop.description && (
          <p className="text-[11px] text-text-muted">{prop.description}</p>
        )}
        <select
          value={String(value ?? prop.default ?? "")}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 w-full rounded-md border bg-surface px-2 text-xs text-text focus:outline-none focus:ring-2 focus:ring-ring/40"
        >
          {prop.enum.map((opt) => (
            <option key={String(opt)} value={String(opt)}>
              {String(opt)}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (type === "boolean") {
    const checked = Boolean(value ?? prop.default ?? false);
    return (
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-xs">{label}</Label>
          {prop.description && (
            <p className="text-[11px] text-text-muted">{prop.description}</p>
          )}
        </div>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 accent-primary"
        />
      </div>
    );
  }

  if (type === "integer" || type === "number") {
    return (
      <div className="space-y-1.5">
        <Label htmlFor={`cfg-${fieldKey}`} className="text-xs">
          {label}
        </Label>
        {prop.description && (
          <p className="text-[11px] text-text-muted">{prop.description}</p>
        )}
        <Input
          id={`cfg-${fieldKey}`}
          type="number"
          value={String(value ?? prop.default ?? "")}
          min={prop.minimum ?? prop.exclusiveMinimum}
          max={prop.maximum ?? prop.exclusiveMaximum}
          onChange={(e) =>
            onChange(type === "integer" ? parseInt(e.target.value, 10) : parseFloat(e.target.value))
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor={`cfg-${fieldKey}`} className="text-xs">
        {label}
      </Label>
      {prop.description && (
        <p className="text-[11px] text-text-muted">{prop.description}</p>
      )}
      <Input
        id={`cfg-${fieldKey}`}
        value={String(value ?? prop.default ?? "")}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
