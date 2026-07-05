"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowLeft, Share2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { FlowCanvasSkeleton } from "@/components/flows/flow-canvas-skeleton";
import { FlowEditor } from "@/components/flows/flow-editor";
import { useFlow } from "@/lib/flow-queries";

// The share dialog (radix Dialog + react-hook-form + zod) is only opened on
// demand; lazy-load it so its deps stay out of the /flows/[flowId] First Load JS.
const FlowShareDialog = dynamic(
  () => import("@/components/flows/flow-share-dialog").then((m) => m.FlowShareDialog),
  { ssr: false },
);

export function FlowEditorPage({ flowId }: { flowId: string }) {
  const { data: flow, isLoading, isError } = useFlow(flowId);
  const [shareOpen, setShareOpen] = useState(false);

  if (isLoading) {
    return <FlowCanvasSkeleton />;
  }
  if (isError || !flow) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
        <p>Flow not found.</p>
        <Link href="/flows" className="text-primary underline">
          Back to Builder
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <Link
          href="/flows"
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Back to Builder"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="truncate text-sm font-semibold tracking-tight">{flow.name}</h1>
        {flow.is_owner && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="ml-auto h-7 gap-1.5 text-xs"
            onClick={() => setShareOpen(true)}
          >
            <Share2 className="h-3.5 w-3.5" />
            Share
          </Button>
        )}
      </div>
      <div className="min-h-0 flex-1">
        <FlowEditor flow={flow} />
      </div>
      {flow.is_owner && (
        <FlowShareDialog
          flowId={flow.id}
          flowName={flow.name}
          open={shareOpen}
          onOpenChange={setShareOpen}
        />
      )}
    </div>
  );
}
