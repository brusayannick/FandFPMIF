"use client";

import dynamic from "next/dynamic";

const CanvasWorkspace = dynamic(
  () =>
    import("@/components/canvas/CanvasWorkspace").then((m) => ({
      default: m.CanvasWorkspace,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center text-sm text-text-muted">
        Loading canvas…
      </div>
    ),
  },
);

export function ProcessDetailClient({ id }: { id: string }) {
  return (
    <CanvasWorkspace
      processId={id}
      fallbackName={id === "demo" ? "Demo process" : undefined}
    />
  );
}
