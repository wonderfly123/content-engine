"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { ReelCutView, ReelStage } from "@/lib/reels/store";

async function fetchCuts(brandSlug: string): Promise<ReelCutView[]> {
  const res = await fetch(`/api/reels?brand=${encodeURIComponent(brandSlug)}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return ((await res.json()) as { cuts: ReelCutView[] }).cuts;
}

/** Instagram Reel stages that are waiting on the user, in pipeline order. */
const WAITING_ON_YOU: Array<{ stage: ReelStage; label: string; href: string }> = [
  { stage: "cut_review", label: "Cuts to review", href: "/instagram/cuts" },
  { stage: "voiceover", label: "Voice-overs to record", href: "/instagram/voiceover" },
  { stage: "final_review", label: "Finished videos to approve and schedule", href: "/instagram/final" },
];

export function NeedsReviewCard({ brandSlug }: { brandSlug: string }) {
  const cutsQ = useQuery({
    queryKey: ["dashboard-reels", brandSlug],
    queryFn: () => fetchCuts(brandSlug),
    retry: 1,
    refetchInterval: 30_000,
  });
  const count = (stage: ReelStage) => cutsQ.data?.filter((c) => c.stage === stage).length;
  const withEditor = count("editing") ?? 0;
  const nothingWaiting = cutsQ.isSuccess && WAITING_ON_YOU.every((w) => count(w.stage) === 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Needs review</CardTitle>
        <CardDescription>Instagram Reels waiting on you</CardDescription>
      </CardHeader>
      <CardContent>
        {cutsQ.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : nothingWaiting ? (
          <p className="text-sm text-muted-foreground">Nothing waiting on you.</p>
        ) : (
          <ul className="space-y-2" role="list">
            {WAITING_ON_YOU.map((w) => (
              <ReviewRow
                key={w.stage}
                label={w.label}
                href={w.href}
                count={count(w.stage)}
                error={cutsQ.isError}
                errorLabel="Couldn't load the review pipeline."
              />
            ))}
          </ul>
        )}
        {withEditor > 0 && (
          <p className="mt-3 text-xs text-muted-foreground">
            {withEditor} more {withEditor === 1 ? "is" : "are"} with the editor.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function ReviewRow({
  label,
  href,
  count,
  error,
  errorLabel,
}: {
  label: string;
  href: string;
  count: number | undefined;
  error: boolean;
  errorLabel: string;
}) {
  if (error || count === undefined) {
    return (
      <li className="flex items-center rounded-md border px-3 py-2 text-sm text-muted-foreground">
        {errorLabel}
      </li>
    );
  }
  return (
    <li>
      <Link
        href={href}
        className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent"
      >
        <span
          className={
            count > 0
              ? "inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold tabular-nums text-primary-foreground"
              : "inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-muted px-1.5 text-xs font-semibold tabular-nums text-muted-foreground"
          }
        >
          {count}
        </span>
        <span className={count > 0 ? "font-medium" : "text-muted-foreground"}>
          {label}
        </span>
        <ChevronRight
          className="ml-auto h-4 w-4 text-muted-foreground"
          aria-hidden="true"
        />
      </Link>
    </li>
  );
}
