import { Skeleton } from "@/components/ui/skeleton";

export default function RootLoading() {
  return (
    <div
      className="flex min-h-screen items-center justify-center p-6"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <Skeleton className="h-32 w-full max-w-md" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
