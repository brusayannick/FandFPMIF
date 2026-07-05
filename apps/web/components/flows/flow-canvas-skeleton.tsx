import { Skeleton } from "@/components/ui/skeleton";

/**
 * Toolbar strip + full-height canvas – the flow editor's loading shell.
 * Shared by the route's loading.tsx and FlowEditorPage's isLoading state so
 * route-load and query-load render the identical skeleton.
 */
export function FlowCanvasSkeleton() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <Skeleton className="h-7 w-7 rounded-md" />
        <Skeleton className="h-4 w-48" />
        <Skeleton className="ml-auto h-7 w-20 rounded-md" />
      </div>
      <div className="min-h-0 flex-1 p-3">
        <Skeleton className="h-full w-full rounded-lg" />
      </div>
    </div>
  );
}
