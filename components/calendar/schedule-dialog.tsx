"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Generic schedule dialog. Callers pass `draftId` + a pre-filled `defaultDate`
 * (typically `nextOpenSlot()` from lib/calendar/slots) and we POST to
 * /api/posts/[id]/schedule on confirm.
 */
export function ScheduleDialog({
  open,
  onOpenChange,
  draftId,
  defaultDate,
  onScheduled,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  draftId: string;
  defaultDate: Date;
  onScheduled?: (postId: string) => void;
}) {
  const [when, setWhen] = useState(toInputValue(defaultDate));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setWhen(toInputValue(defaultDate));
      setError(null);
    }
  }, [open, defaultDate]);

  async function confirm() {
    setError(null);
    setSubmitting(true);
    try {
      const target = new Date(when);
      const res = await fetch(`/api/posts/${draftId}/schedule`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scheduledFor: target.toISOString() }),
      });
      const json = (await res.json()) as {
        data: { post: { id: string } } | null;
        error: { code: string; message?: string } | null;
      };
      if (!res.ok || !json.data) {
        setError(json.error?.message ?? json.error?.code ?? "Failed to schedule");
        return;
      }
      onScheduled?.(json.data.post.id);
      onOpenChange(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Schedule post</DialogTitle>
          <DialogDescription>
            Default time is the next open slot in your cadence. Adjust if needed.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="schedule-when">Publish at (local time)</Label>
          <Input
            id="schedule-when"
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
          />
          {error && (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={confirm} disabled={submitting}>
            {submitting ? "Scheduling…" : "Schedule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function toInputValue(d: Date): string {
  // <input type="datetime-local"> expects a "YYYY-MM-DDTHH:mm" local string.
  return format(d, "yyyy-MM-dd'T'HH:mm");
}
