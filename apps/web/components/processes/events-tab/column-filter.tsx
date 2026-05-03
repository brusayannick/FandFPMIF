"use client";

import { useState, type ReactNode } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ColumnSpec, FilterEntry, FilterOp } from "@/lib/api-types";

const OPS_BY_TYPE: Record<ColumnSpec["type"], FilterOp[]> = {
  string: ["contains", "equals", "is_null", "is_not_null"],
  number: ["equals", "gte", "lte", "is_null", "is_not_null"],
  duration: ["equals", "gte", "lte", "is_null", "is_not_null"],
  datetime: ["equals", "gte", "lte", "is_null", "is_not_null"],
  enum: ["equals", "is_null", "is_not_null"],
  boolean: ["equals", "is_null", "is_not_null"],
};

const OP_LABELS: Record<FilterOp, string> = {
  contains: "contains",
  equals: "equals",
  gte: "≥",
  lte: "≤",
  is_null: "is empty",
  is_not_null: "is not empty",
};

export interface ColumnFilterProps {
  column: ColumnSpec;
  current: FilterEntry | null;
  onChange: (next: FilterEntry | null) => void;
  children: ReactNode;
}

export function ColumnFilter({ column, current, onChange, children }: ColumnFilterProps) {
  const ops = OPS_BY_TYPE[column.type] ?? OPS_BY_TYPE.string;
  const [open, setOpen] = useState(false);
  const [op, setOp] = useState<FilterOp>(current?.op ?? ops[0]);
  const [value, setValue] = useState<string>(
    current?.value !== undefined && current.value !== null ? String(current.value) : "",
  );

  const apply = () => {
    if (op === "is_null" || op === "is_not_null") {
      onChange({ field: column.name, op });
    } else if (value === "") {
      onChange(null);
    } else {
      onChange({ field: column.name, op, value: castValue(value, column) });
    }
    setOpen(false);
  };

  const clear = () => {
    onChange(null);
    setValue("");
    setOpen(false);
  };

  const showValueInput = op !== "is_null" && op !== "is_not_null";
  const inputType =
    column.type === "datetime"
      ? "datetime-local"
      : column.type === "number" || column.type === "duration"
        ? "number"
        : "text";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" className="w-72">
        <div className="space-y-3">
          <div>
            <Label className="text-xs text-muted-foreground">Filter {column.label}</Label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Select value={op} onValueChange={(v) => setOp(v as FilterOp)}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ops.map((o) => (
                  <SelectItem key={o} value={o}>
                    {OP_LABELS[o]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {showValueInput &&
              (column.type === "enum" && column.enum_values ? (
                <Select value={value} onValueChange={setValue}>
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue placeholder="Pick…" />
                  </SelectTrigger>
                  <SelectContent>
                    {column.enum_values.map((v) => (
                      <SelectItem key={v} value={v}>
                        {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  type={inputType}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  className="h-8 text-sm"
                />
              ))}
          </div>
          <div className="flex justify-between">
            <Button variant="ghost" size="sm" onClick={clear} className="cursor-pointer">
              Clear
            </Button>
            <Button size="sm" onClick={apply} className="cursor-pointer">
              Apply
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function castValue(raw: string, column: ColumnSpec): string | number | boolean | null {
  if (column.type === "number" || column.type === "duration") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : raw;
  }
  if (column.type === "boolean") return raw === "true";
  return raw;
}
