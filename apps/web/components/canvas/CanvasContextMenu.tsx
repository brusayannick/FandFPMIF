"use client";

import { useEffect, useRef } from "react";
import { Copy, Trash2, ArrowRightFromLine } from "lucide-react";
import { cn } from "@/lib/utils";
import { useProcessStore } from "@/stores/process.store";

export type ContextMenuTarget =
  | { kind: "node"; id: string; nodeType: string; label: string }
  | { kind: "edge"; id: string; label?: string }
  | null;

interface CanvasContextMenuProps {
  target: ContextMenuTarget;
  position: { x: number; y: number };
  onClose: () => void;
}

export function CanvasContextMenu({
  target,
  position,
  onClose,
}: CanvasContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const removeNode = useProcessStore((s) => s.removeNode);
  const removeEdge = useProcessStore((s) => s.removeEdge);
  const duplicateNode = useProcessStore((s) => s.duplicateNode);
  const updateNodeData = useProcessStore((s) => s.updateNodeData);

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  if (!target) return null;

  const menuStyle: React.CSSProperties = {
    position: "fixed",
    top: position.y,
    left: position.x,
    zIndex: 1000,
  };

  return (
    <div
      ref={ref}
      style={menuStyle}
      className="min-w-[180px] overflow-hidden rounded-lg border border-border bg-surface shadow-lg"
      onContextMenu={(e) => e.preventDefault()}
    >
      {target.kind === "node" ? (
        <NodeMenu
          target={target}
          onClose={onClose}
          onDelete={() => { removeNode(target.id); onClose(); }}
          onDuplicate={() => { duplicateNode(target.id); onClose(); }}
          onSetStatus={(status) => {
            updateNodeData(target.id, { status });
            onClose();
          }}
        />
      ) : (
        <EdgeMenu
          target={target}
          onClose={onClose}
          onDelete={() => { removeEdge(target.id); onClose(); }}
        />
      )}
    </div>
  );
}

function NodeMenu({
  target,
  onDelete,
  onDuplicate,
  onSetStatus,
}: {
  target: Extract<ContextMenuTarget, { kind: "node" }>;
  onClose: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onSetStatus: (s: "idle" | "active" | "blocked" | "done") => void;
}) {
  return (
    <>
      <div className="border-b border-border px-3 py-2">
        <div className="text-[10px] font-medium uppercase tracking-wider text-text-faint">
          {target.nodeType}
        </div>
        <div className="truncate text-xs font-medium text-text">
          {target.label}
        </div>
      </div>

      <div className="p-1">
        <MenuItem icon={Copy} label="Duplicate" onClick={onDuplicate} />
      </div>

      <div className="border-t border-border p-1">
        <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-text-faint">
          Set status
        </div>
        {(["idle", "active", "blocked", "done"] as const).map((s) => (
          <MenuItem
            key={s}
            icon={ArrowRightFromLine}
            label={s.charAt(0).toUpperCase() + s.slice(1)}
            onClick={() => onSetStatus(s)}
            className={
              s === "active"
                ? "text-success"
                : s === "blocked"
                  ? "text-error"
                  : s === "done"
                    ? "text-primary"
                    : ""
            }
          />
        ))}
      </div>

      <div className="border-t border-border p-1">
        <MenuItem
          icon={Trash2}
          label="Delete node"
          onClick={onDelete}
          danger
        />
      </div>
    </>
  );
}

function EdgeMenu({
  target,
  onDelete,
}: {
  target: Extract<ContextMenuTarget, { kind: "edge" }>;
  onClose: () => void;
  onDelete: () => void;
}) {
  return (
    <>
      <div className="border-b border-border px-3 py-2">
        <div className="text-[10px] font-medium uppercase tracking-wider text-text-faint">
          Connection
        </div>
        {target.label && (
          <div className="truncate text-xs font-medium text-text">
            {target.label}
          </div>
        )}
      </div>
      <div className="p-1">
        <MenuItem icon={Trash2} label="Delete connection" onClick={onDelete} danger />
      </div>
    </>
  );
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  danger = false,
  className,
}: {
  icon: React.ElementType;
  label: string;
  onClick: () => void;
  danger?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors",
        danger
          ? "text-error hover:bg-error/10"
          : "text-text hover:bg-surface-offset",
        className,
      )}
    >
      <Icon size={13} className="shrink-0" />
      {label}
    </button>
  );
}
