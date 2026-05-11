"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileEdit, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { useBrandStore } from "@/lib/stores/brand-store";
import { EmptyState } from "@/components/empty-state";
import { BriefCard, type BriefRow } from "./brief-card";
import { BriefForm } from "./brief-form";
import { RejectDialog } from "./reject-dialog";

interface BriefQueueProps {
  /** Optional channel filter (used by /instagram, /facebook routes). */
  channel?: string;
}

async function fetchBriefs(
  brandId: string | undefined,
  channel?: string,
): Promise<BriefRow[]> {
  if (!brandId) return [];
  const params = new URLSearchParams({ brandId });
  if (channel) params.set("channel", channel);
  const res = await fetch(`/api/briefs?${params.toString()}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as { briefs: BriefRow[] };
  return json.briefs;
}

export function BriefQueue({ channel }: BriefQueueProps) {
  const qc = useQueryClient();
  const active = useBrandStore((s) => s.active);
  const looksLikeUuid =
    typeof active?.id === "string" && /^[0-9a-f-]{36}$/i.test(active.id);
  const brandId = looksLikeUuid ? active!.id : undefined;

  const { data, isLoading, isError } = useQuery({
    queryKey: ["briefs", brandId, channel],
    queryFn: () => fetchBriefs(brandId, channel),
    enabled: Boolean(brandId),
  });

  const [editing, setEditing] = useState<BriefRow | null>(null);
  const [rejecting, setRejecting] = useState<BriefRow | null>(null);

  const refresh = () =>
    qc.invalidateQueries({ queryKey: ["briefs", brandId, channel] });

  const approve = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/briefs/${id}/approve`, { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    onSuccess: () => {
      toast.success("Brief approved — draft generation queued.");
      refresh();
    },
    onError: (err) => toast.error(`Approve failed: ${(err as Error).message}`),
  });

  const reject = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const res = await fetch(`/api/briefs/${id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    },
    onSuccess: () => {
      toast.success("Brief rejected.");
      refresh();
    },
    onError: (err) => toast.error(`Reject failed: ${(err as Error).message}`),
  });

  const savePatch = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<BriefRow> }) => {
      const res = await fetch(`/api/briefs/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...patch, markEdited: true }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    },
    onSuccess: () => {
      toast.success("Brief updated.");
      refresh();
    },
    onError: (err) => toast.error(`Save failed: ${(err as Error).message}`),
  });

  const generateMore = useMutation({
    mutationFn: async () => {
      if (!brandId) throw new Error("No active brand");
      const res = await fetch(`/api/briefs/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    },
    onSuccess: () => toast.success("Brief batch enqueued."),
    onError: (err) => toast.error(`Enqueue failed: ${(err as Error).message}`),
  });

  const all = data ?? [];
  const pending = all.filter(
    (b) => b.status === "pending_review" || b.status === "edited",
  );
  const approved = all.filter((b) => b.status === "approved");
  const rejected = all.filter((b) => b.status === "rejected");

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Briefs</h2>
          <p className="text-sm text-muted-foreground">
            Weekly batch — approve, edit, or reject before drafts are generated.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refresh()}
            aria-label="Refresh briefs list"
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            Refresh
          </Button>
          <Button
            size="sm"
            onClick={() => generateMore.mutate()}
            disabled={!brandId || generateMore.isPending}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            Generate more
          </Button>
        </div>
      </div>

      <Tabs defaultValue="pending" className="mt-6">
        <TabsList>
          <TabsTrigger value="pending">
            Pending ({pending.length})
          </TabsTrigger>
          <TabsTrigger value="approved">Approved ({approved.length})</TabsTrigger>
          <TabsTrigger value="rejected">Rejected ({rejected.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="pending" className="mt-4 space-y-3">
          {isLoading && <ListSkeleton />}
          {isError && (
            <p className="text-sm text-destructive">Failed to load briefs.</p>
          )}
          {!isLoading && pending.length === 0 && (
            <EmptyState
              icon={FileEdit}
              title="No briefs to review"
              description="Generate a fresh batch or wait for Monday's cron."
              action={
                <Button
                  onClick={() => generateMore.mutate()}
                  disabled={!brandId}
                >
                  Generate briefs now
                </Button>
              }
            />
          )}
          {pending.map((b) => (
            <BriefCard
              key={b.id}
              brief={b}
              onApprove={(x) => approve.mutate(x.id)}
              onEdit={(x) => setEditing(x)}
              onReject={(x) => setRejecting(x)}
              busy={approve.isPending || reject.isPending}
            />
          ))}
        </TabsContent>
        <TabsContent value="approved" className="mt-4 space-y-3">
          {approved.length === 0 && (
            <EmptyState
              title="Nothing approved yet"
              description="Approve a brief to fire draft generation."
            />
          )}
          {approved.map((b) => (
            <BriefCard key={b.id} brief={b} />
          ))}
        </TabsContent>
        <TabsContent value="rejected" className="mt-4 space-y-3">
          {rejected.length === 0 && (
            <EmptyState
              title="No rejections"
              description="Rejected briefs help the system learn what not to ship."
            />
          )}
          {rejected.map((b) => (
            <BriefCard key={b.id} brief={b} />
          ))}
        </TabsContent>
      </Tabs>

      <Sheet open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>Edit brief</SheetTitle>
            <SheetDescription>
              Saving sets the status to `edited`. Approving from the queue then
              fires draft generation.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4">
            {editing && (
              <BriefForm
                brief={editing}
                onSave={async (patch) => {
                  await savePatch.mutateAsync({ id: editing.id, patch });
                  setEditing(null);
                }}
                onCancel={() => setEditing(null)}
              />
            )}
          </div>
        </SheetContent>
      </Sheet>

      <RejectDialog
        open={!!rejecting}
        title="Reject brief?"
        description="Tell us why so the system can learn for next week."
        onClose={() => setRejecting(null)}
        onSubmit={async (reason) => {
          if (rejecting) await reject.mutateAsync({ id: rejecting.id, reason });
        }}
      />
    </>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-32 w-full" />
      ))}
    </div>
  );
}
