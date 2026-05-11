import { Skeleton } from "@/components/ui/skeleton";

export default function BrandLoading() {
  return (
    <div
      className="mx-auto max-w-5xl space-y-4"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <Skeleton className="h-8 w-1/3" />
      <Skeleton className="h-4 w-2/3" />
      <div className="space-y-3">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
