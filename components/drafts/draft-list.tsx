"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileCheck2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { useBrandStore } from "@/lib/stores/brand-store";
import { EmptyState } from "@/components/empty-state";
import { RejectDialog } from "@/components/briefs/reject-dialog";
import { DraftCard, type DraftRow } from "./draft-card";
import { AssetAttachBar } from "./asset-attach-bar";

interface DraftListProps {
  channel?: string;
}

async function fetchDrafts(
  brandId: string | undefined,
  channel?: string,
): Promise<DraftRow[]> {
  if (!brandId) return [];
  const params = new URLSearchParams({ brandId });
  if (channel) params.set("channel", channel);
  const res = await fetch(`/api/drafts?${params.toString()}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as { drafts: DraftRow[] };
  return json.drafts;
}

const GROUPS = [
  { key: "pending_review", label: "Pending" },
  { key: "awaiting_assets", label: "Needs assets" },
  { key: "awaiting_final_review", label: "Final review" },
  { key: "scheduled", label: "Scheduled" },
  { key: "rejected", label: "Rejected" },
] as const;

export function DraftList({ channel }: DraftListProps) {
  const qc = useQueryClient();
  const active = useBrandStore((s) => s.active);
  const looksLikeUuid =
    typeof active?.id === "string" && /^[0-9a-f-]{36}$/i.test(active.id);
  const brandId = looksLikeUuid ? active!.id : undefined;

  const { data, isLoading, isError } = useQuery({
    queryKey: ["drafts", brandId, channel],
    queryFn: () => fetchDrafts(brandId, channel),
    enabled: Boolean(brandId),
  });

  const [rejecting, setRejecting] = useState<DraftRow | null>(null);
  const [attaching, setAttaching] = useState<DraftRow | null>(null);

  const refresh = () =>
    qc.invalidateQueries({ queryKey: ["drafts", brandId, channel] });

  const approve = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/drafts/${id}/approve`, { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    },
    onSuccess: () => {
      toast.success("Draft approved — awaiting assets.");
      refresh();
    },
    onError: (e) => toast.error(`Approve failed: ${(e as Error).message}`),
  });

  const reject = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const res = await fetch(`/api/drafts/${id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    },
    onSuccess: () => {
      toast.success("Draft rejected.");
      refresh();
    },
    onError: (e) => toast.error(`Reject failed: ${(e as Error).message}`),
  });

  const grouped = useMemo(() => {
    const out: Record<string, DraftRow[]> = {};
    for (const g of GROUPS) out[g.key] = [];
    out["edited"] = [];
    out["approved"] = [];
    for (const d of data ?? []) {
      const bucket = out[d.status] ?? (out[d.status] = []);
      bucket.push(d);
    }
    // edited + pending_review share the "pending" view; approved is hidden.
    out.pending_review = [...out.pending_review, ...out.edited];
    return out;
  }, [data]);

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Drafts</h2>
          <p className="text-sm text-muted-foreground">
            Generated copy + scripts. Approve, attach assets, then schedule.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refresh()}
          aria-label="Refresh drafts"
        >
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          Refresh
        </Button>
      </div>

      <Tabs defaultValue="pending_review" className="mt-6">
        <TabsList className="flex flex-wrap">
          {GROUPS.map((g) => (
            <TabsTrigger key={g.key} value={g.key}>
              {g.label} ({grouped[g.key]?.length ?? 0})
            </TabsTrigger>
          ))}
        </TabsList>
        {GROUPS.map((g) => (
          <TabsContent
            key={g.key}
            value={g.key}
            className="mt-4 space-y-3"
          >
            {isLoading && (
              <>
                <Skeleton className="h-28 w-full" />
                <Skeleton className="h-28 w-full" />
              </>
            )}
            {isError && (
              <p className="text-sm text-destructive">Failed to load drafts.</p>
            )}
            {!isLoading && (grouped[g.key]?.length ?? 0) === 0 && (
              <EmptyState
                icon={FileCheck2}
                title={`No drafts in ${g.label.toLowerCase()}`}
                description={emptyHint(g.key)}
              />
            )}
            {(grouped[g.key] ?? []).map((d) => (
              <DraftCard
                key={d.id}
                draft={d}
                onApprove={(x) => approve.mutate(x.id)}
                onReject={(x) => setRejecting(x)}
                onAttach={(x) => setAttaching(x)}
                onScheduled={refresh}
                busy={approve.isPending || reject.isPending}
              />
            ))}
            {g.key === "awaiting_final_review" &&
              (grouped[g.key] ?? []).length > 0 && (
                <div className="text-xs text-muted-foreground">
                  Tip: use the Schedule button on each card.
                </div>
              )}
          </TabsContent>
        ))}
      </Tabs>

      <RejectDialog
        open={!!rejecting}
        title="Reject draft?"
        description="Tell us why so future drafts can learn."
        onClose={() => setRejecting(null)}
        onSubmit={async (reason) => {
          if (rejecting) await reject.mutateAsync({ id: rejecting.id, reason });
        }}
      />

      {attaching && (
        <AssetAttachBar
          open={!!attaching}
          onClose={() => setAttaching(null)}
          draftId={attaching.id}
          brandId={attaching.brandId}
          format={attaching.format}
          attachedSlots={[]}
        />
      )}
    </>
  );
}

function emptyHint(status: string): string {
  switch (status) {
    case "pending_review":
      return "Approve briefs to generate drafts here.";
    case "awaiting_assets":
      return "Drafts will appear here after approval; attach assets to advance them.";
    case "awaiting_final_review":
      return "Drafts with all assets attached land here.";
    case "scheduled":
      return "Drafts that have been queued for publishing appear here.";
    case "rejected":
      return "No rejections yet — the system learns from these when they happen.";
    default:
      return "";
  }
}

