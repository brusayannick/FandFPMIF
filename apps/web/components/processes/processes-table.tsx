"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { MoreHorizontal, Pencil, Trash2, RefreshCcw } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/cn";
import { formatDateRange, formatNumber, formatRelative } from "@/lib/format";
import type { EventLogSummary } from "@/lib/api-types";
import {
  useDeleteEventLog,
  useReimportEventLog,
  useRenameEventLog,
} from "@/lib/queries";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";

interface ProcessesTableProps {
  rows: EventLogSummary[];
}

export function ProcessesTable({ rows }: ProcessesTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[40%]">Name</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Cases</TableHead>
          <TableHead className="text-right">Events</TableHead>
          <TableHead className="text-right">Variants</TableHead>
          <TableHead>Date range</TableHead>
          <TableHead>Imported</TableHead>
          <TableHead>Format</TableHead>
          <TableHead className="w-[40px]" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <ProcessRow key={row.id} row={row} />
        ))}
      </TableBody>
    </Table>
  );
}

function ProcessRow({ row }: { row: EventLogSummary }) {
  const router = useRouter();
  const importing = row.status === "importing";
  const failed = row.status === "failed";
  const ready = row.status === "ready";
  const del = useDeleteEventLog();
  const rename = useRenameEventLog();
  const reimport = useReimportEventLog();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [reimportOpen, setReimportOpen] = useState(false);

  const onOpen = () => {
    if (!ready) return;
    router.push(`/processes/${row.id}`);
  };

  const onDelete = async () => {
    try {
      await del.mutateAsync(row.id);
      toast.success(`Deleted "${row.name}"`);
    } catch (err: unknown) {
      toast.error(`Delete failed: ${(err as Error).message}`);
    }
  };

  const onReimport = async () => {
    try {
      await reimport.mutateAsync(row.id);
      toast.success(`Re-importing "${row.name}"`);
    } catch (err: unknown) {
      toast.error(`Re-import failed: ${(err as Error).message}`);
    }
  };

  return (
    <TableRow
      className={cn(
        "h-[var(--row-height)]",
        ready && "cursor-pointer",
        importing && "opacity-60",
      )}
      onClick={ready ? onOpen : undefined}
    >
      <TableCell className="max-w-0">
        <div className="truncate font-medium">{row.name}</div>
        {importing && (
          <div className="mt-1 max-w-xs">
            <Progress value={undefined} className="h-1" />
          </div>
        )}
      </TableCell>
      <TableCell>
        {failed ? (
          <HoverCard>
            <HoverCardTrigger asChild>
              <span>
                <StatusBadge status={row.status} />
              </span>
            </HoverCardTrigger>
            <HoverCardContent className="text-xs">
              <p className="font-medium">Import failed</p>
              <p className="mt-1 text-muted-foreground break-words">
                {row.error ?? "No error recorded."}
              </p>
            </HoverCardContent>
          </HoverCard>
        ) : (
          <StatusBadge status={row.status} />
        )}
      </TableCell>
      <TableCell className="text-right tabular-nums">{formatNumber(row.cases_count)}</TableCell>
      <TableCell className="text-right tabular-nums">{formatNumber(row.events_count)}</TableCell>
      <TableCell className="text-right tabular-nums">
        {formatNumber(row.variants_count)}
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {formatDateRange(row.date_min, row.date_max)}
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        <span title={row.imported_at ?? row.created_at}>
          {formatRelative(row.imported_at ?? row.created_at)}
        </span>
      </TableCell>
      <TableCell className="text-xs uppercase tracking-wide text-muted-foreground">
        {row.source_format ?? "—"}
      </TableCell>
      <TableCell onClick={(e) => e.stopPropagation()}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 cursor-pointer">
              <MoreHorizontal className="h-4 w-4" />
              <span className="sr-only">Row actions</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              disabled={!ready}
              onSelect={(e) => {
                e.preventDefault();
                onOpen();
              }}
              className="cursor-pointer"
            >
              Open
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={importing}
              onSelect={(e) => {
                e.preventDefault();
                setRenameOpen(true);
              }}
              className="cursor-pointer"
            >
              <Pencil className="mr-2 h-3.5 w-3.5" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={importing || !row.source_format}
              onSelect={(e) => {
                e.preventDefault();
                setReimportOpen(true);
              }}
              className="cursor-pointer"
            >
              <RefreshCcw className="mr-2 h-3.5 w-3.5" />
              Re-run import
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
              <AlertDialogTrigger asChild>
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    setConfirmOpen(true);
                  }}
                  className="cursor-pointer text-destructive focus:text-destructive"
                >
                  <Trash2 className="mr-2 h-3.5 w-3.5" />
                  Delete…
                </DropdownMenuItem>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete &ldquo;{row.name}&rdquo;?</AlertDialogTitle>
                  <AlertDialogDescription>
                    The Parquet files and the original upload will be removed
                    from disk. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="cursor-pointer">Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={onDelete}
                    className="cursor-pointer bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </DropdownMenuContent>
        </DropdownMenu>

        <RenameDialog
          open={renameOpen}
          onOpenChange={setRenameOpen}
          currentName={row.name}
          pending={rename.isPending}
          onConfirm={async (next) => {
            try {
              await rename.mutateAsync({ id: row.id, name: next });
              toast.success(`Renamed to "${next}"`);
              setRenameOpen(false);
            } catch (err: unknown) {
              toast.error(`Rename failed: ${(err as Error).message}`);
            }
          }}
        />

        <AlertDialog open={reimportOpen} onOpenChange={setReimportOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Re-run import for &ldquo;{row.name}&rdquo;?</AlertDialogTitle>
              <AlertDialogDescription>
                The original upload on disk is re-parsed from scratch. The log will be marked
                <em> importing </em>and unavailable to open until the new import finishes.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="cursor-pointer">Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={onReimport}
                className="cursor-pointer"
                disabled={reimport.isPending}
              >
                Re-run import
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </TableCell>
    </TableRow>
  );
}

function RenameDialog({
  open,
  onOpenChange,
  currentName,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  currentName: string;
  pending: boolean;
  onConfirm: (name: string) => void | Promise<void>;
}) {
  const [name, setName] = useState(currentName);

  // Reset to the current name whenever the dialog (re-)opens or the row's
  // canonical name changes from outside (e.g. a successful rename elsewhere).
  useEffect(() => {
    if (open) setName(currentName);
  }, [open, currentName]);

  const trimmed = name.trim();
  const canSave = trimmed.length > 0 && trimmed !== currentName.trim() && !pending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename event log</DialogTitle>
          <DialogDescription>The display name shown across the platform.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (canSave) onConfirm(trimmed);
          }}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <Label htmlFor="rename-input" className="text-xs text-muted-foreground">
              Name
            </Label>
            <Input
              id="rename-input"
              autoFocus
              maxLength={255}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="cursor-pointer"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" className="cursor-pointer" disabled={!canSave}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Helper used by the parent page when there's no logId in the URL.
export function processesHref(id: string) {
  return `/processes/${id}` as const;
}

// Re-export Link for header CTAs that point at /processes/import.
export { Link };
