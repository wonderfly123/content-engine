"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { draftAssetRoleValues } from "@/lib/db/enums";
import type { AssetRow } from "./asset-card";

interface DraftOption {
  id: string;
  channel: string;
  format: string;
  caption: string;
}

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  asset: AssetRow;
}

export function AttachToDraftDialog({ open, onOpenChange, asset }: Props) {
  const [drafts, setDrafts] = useState<DraftOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [draftId, setDraftId] = useState<string>("");
  const [slotIndex, setSlotIndex] = useState<number>(0);
  const [role, setRole] = useState<(typeof draftAssetRoleValues)[number]>(
    "primary",
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    fetch(
      `/api/drafts?brandId=${asset.brandId}&status=awaiting_assets`,
    )
      .then(async (r) => (r.ok ? r.json() : { drafts: [] }))
      .then((d: { drafts?: DraftOption[] }) => {
        if (!cancelled) setDrafts(d.drafts ?? []);
      })
      .catch(() => {
        if (!cancelled) setDrafts([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, asset.brandId]);

  async function handleSubmit() {
    if (!draftId) {
      toast.error("Pick a draft");
      return;
    }
    setSubmitting(true);
    try {
      // Reuse POST /api/assets — but with the existing asset id we instead
      // call a dedicated attach endpoint. For Task 7 we re-call POST with
      // the same blobUrl is wrong; the spec calls out a pick-from-library
      // flow whose API is out of scope. We perform a minimal direct attach
      // by re-posting metadata against the existing blob — server will
      // create a new row. To avoid duplicating the asset row, prefer
      // a no-op message until pick-from-library API lands in Task 5/6.
      toast.info(
        "Pick-from-library attach API not in Task 7 scope. Open the draft and use 'Pick from library' once it ships.",
      );
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Attach asset to draft</DialogTitle>
          <DialogDescription>
            Select a draft awaiting assets, then choose a slot and role.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Draft</Label>
            <Select value={draftId} onValueChange={setDraftId}>
              <SelectTrigger>
                <SelectValue
                  placeholder={loading ? "Loading…" : "Pick a draft"}
                />
              </SelectTrigger>
              <SelectContent>
                {drafts.length === 0 && !loading && (
                  <div className="p-2 text-sm text-muted-foreground">
                    No drafts awaiting assets.
                  </div>
                )}
                {drafts.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    [{d.channel}/{d.format}] {d.caption?.slice(0, 50) || d.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="slot">Slot index</Label>
              <Input
                id="slot"
                type="number"
                min={0}
                max={9}
                value={slotIndex}
                onChange={(e) =>
                  setSlotIndex(Math.max(0, Math.min(9, Number(e.target.value))))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select
                value={role}
                onValueChange={(v) =>
                  setRole(v as (typeof draftAssetRoleValues)[number])
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {draftAssetRoleValues.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || !draftId}>
            Attach
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
