"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

interface AssetAttachBarProps {
  open: boolean;
  onClose: () => void;
  draftId: string;
  brandId: string;
  format: string;
  /** Existing attachments to skip + suggest next slot. */
  attachedSlots: number[];
}

interface AssetRow {
  id: string;
  kind: string;
  label: string;
  storageUrl: string;
  thumbnailUrl: string | null;
  durationSec: number | null;
}

async function fetchAssets(brandId: string, format: string): Promise<AssetRow[]> {
  const kind = format === "carousel" || format === "image" ? "image" : "video";
  const res = await fetch(
    `/api/assets?brandId=${brandId}&kind=${kind}&archived=false`,
    { cache: "no-store" },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as { assets: AssetRow[] };
  return json.assets;
}

export function AssetAttachBar({
  open,
  onClose,
  draftId,
  brandId,
  format,
  attachedSlots,
}: AssetAttachBarProps) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const nextSlot = nextFreeSlot(attachedSlots);

  const { data, isLoading } = useQuery({
    queryKey: ["assets", brandId, format],
    queryFn: () => fetchAssets(brandId, format),
    enabled: open,
  });

  const attach = useMutation({
    mutationFn: async (assetId: string) => {
      const res = await fetch(`/api/drafts/${draftId}/attach`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assetId,
          slotIndex: nextSlot,
          role: format === "reel" || format === "image" ? "primary" : "primary",
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { detail?: string; error?: string } | null;
        throw new Error(j?.detail ?? j?.error ?? `HTTP ${res.status}`);
      }
      return res.json();
    },
    onSuccess: (data) => {
      toast.success(
        (data as { transitioned?: boolean }).transitioned
          ? "Attached. Draft moved to final review."
          : "Asset attached.",
      );
      qc.invalidateQueries({ queryKey: ["draft", draftId] });
      qc.invalidateQueries({ queryKey: ["drafts"] });
      onClose();
    },
    onError: (err) => toast.error(`Attach failed: ${(err as Error).message}`),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[80vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Attach an asset</DialogTitle>
          <DialogDescription>
            Pick from your library. Next slot: #{nextSlot}.
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="grid grid-cols-3 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="aspect-square w-full" />
            ))}
          </div>
        ) : (data ?? []).length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No assets in your library yet. Upload via the Assets page.
          </p>
        ) : (
          <ul
            role="listbox"
            aria-label="Library assets"
            className="grid grid-cols-2 gap-3 sm:grid-cols-3"
          >
            {(data ?? []).map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => setSelected(a.id)}
                  className={
                    "block w-full overflow-hidden rounded-md border text-left transition " +
                    (selected === a.id
                      ? "ring-2 ring-primary"
                      : "hover:border-primary/50")
                  }
                  aria-pressed={selected === a.id}
                  aria-label={`Select ${a.label || a.id}`}
                >
                  <div className="relative aspect-square bg-muted">
                    {a.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={a.thumbnailUrl}
                        alt={a.label || "Asset thumbnail"}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                        No preview
                      </div>
                    )}
                  </div>
                  <div className="p-2">
                    <p className="truncate text-xs">{a.label || a.id}</p>
                    <Badge variant="outline" className="mt-1 text-[10px] capitalize">
                      {a.kind}
                    </Badge>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => selected && attach.mutate(selected)}
            disabled={!selected || attach.isPending}
          >
            {attach.isPending ? "Attaching…" : "Attach selected"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function nextFreeSlot(taken: number[]): number {
  const set = new Set(taken);
  for (let i = 0; i < 20; i++) if (!set.has(i)) return i;
  return taken.length;
}
