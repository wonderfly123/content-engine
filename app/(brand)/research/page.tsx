"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import { useBrandStore } from "@/lib/stores/brand-store";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { BundleOverview } from "@/components/research/bundle-overview";
import { CompetitorFindings } from "@/components/research/competitor-findings";
import { KeywordFindings } from "@/components/research/keyword-findings";
import { HashtagChips } from "@/components/research/hashtag-chips";

interface ResearchBundleDTO {
  id: string;
  brandId: string;
  pulledAt: string | null;
  competitorFindingsJson: unknown[];
  keywordFindingsJson: unknown[];
  trendingHashtagsJson: unknown[];
  llmPatternSummary: string;
  status: "fresh" | "stale" | "partial";
  errorNotes: string | null;
}

async function fetchBundle(
  brandId: string | undefined,
): Promise<ResearchBundleDTO | null> {
  if (!brandId) return null;
  const res = await fetch(`/api/research?brandId=${brandId}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as { bundle: ResearchBundleDTO | null };
  return json.bundle;
}

export default function ResearchPage() {
  const qc = useQueryClient();
  const active = useBrandStore((s) => s.active);
  const looksLikeUuid =
    typeof active?.id === "string" && /^[0-9a-f-]{36}$/i.test(active.id);
  const brandId = looksLikeUuid ? active!.id : undefined;

  const { data, isLoading, isError } = useQuery({
    queryKey: ["research", brandId],
    queryFn: () => fetchBundle(brandId),
    enabled: Boolean(brandId),
  });

  const refresh = useMutation({
    mutationFn: async () => {
      if (!brandId) throw new Error("No active brand");
      const res = await fetch(`/api/research`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    },
    onSuccess: () => {
      toast.success("Research pull enqueued — refresh in a minute.");
      qc.invalidateQueries({ queryKey: ["research", brandId] });
    },
    onError: (e) => toast.error(`Failed: ${(e as Error).message}`),
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Research</h2>
          <p className="text-sm text-muted-foreground">
            Competitor, keyword, and hashtag signals — refreshed weekly on
            Sundays at 18:00.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => refresh.mutate()}
          disabled={!brandId || refresh.isPending}
          aria-label="Refresh research now"
        >
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          Refresh research now
        </Button>
      </div>

      {isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      )}
      {isError && (
        <p className="text-sm text-destructive">Failed to load research.</p>
      )}
      {!isLoading && !data && (
        <EmptyState
          icon={Search}
          title="No research bundle yet"
          description="Trigger a pull or wait for Sunday's cron."
          action={
            <Button onClick={() => refresh.mutate()} disabled={!brandId}>
              Pull research now
            </Button>
          }
        />
      )}
      {data && (
        <>
          <BundleOverview
            pulledAt={data.pulledAt}
            status={data.status}
            llmPatternSummary={data.llmPatternSummary}
            errorNotes={data.errorNotes}
          />
          <CompetitorFindings
            findings={(data.competitorFindingsJson ?? []) as never[]}
          />
          <KeywordFindings
            findings={(data.keywordFindingsJson ?? []) as never[]}
          />
          <HashtagChips
            hashtags={(data.trendingHashtagsJson ?? []) as never[]}
          />
        </>
      )}
    </div>
  );
}
