import { CardGridSkeleton } from "@/components/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

// Mirrors FlowList's `p-6 space-y-5` frame (header + card grid) so the
// skeleton and the loaded page share geometry.
export default function FlowsLoading() {
  return (
    <div className="space-y-5 p-6">
      <header className="flex items-start justify-between">
        <div className="space-y-2">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <Skeleton className="h-9 w-28 rounded-md" />
      </header>
      <CardGridSkeleton count={6} />
    </div>
  );
}
