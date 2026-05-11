"use client";

import { useState } from "react";
import { Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ScheduleButtonProps {
  draftId: string;
  disabled?: boolean;
  defaultDate?: string; // YYYY-MM-DDTHH:mm
  onScheduled?: () => void;
}

/**
 * Inline schedule control. Task 8 owns the calendar; we provide a minimal
 * date/time picker so drafts can be queued without leaving the page.
 *
 * POSTs to /api/posts (built by Task 8). We surface errors via the dialog
 * so the user knows when the endpoint isn't wired yet.
 */
export function ScheduleButton({
  draftId,
  disabled,
  defaultDate,
  onScheduled,
}: ScheduleButtonProps) {
  const [open, setOpen] = useState(false);
  const [when, setWhen] = useState(defaultDate ?? defaultLocal());
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/posts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftId,
          scheduledFor: new Date(when).toISOString(),
        }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as
          | { error?: string; detail?: string }
          | null;
        throw new Error(json?.detail ?? json?.error ?? `HTTP ${res.status}`);
      }
      onScheduled?.();
      setOpen(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" disabled={disabled}>
          <Calendar className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          Schedule
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Schedule draft</DialogTitle>
          <DialogDescription>
            Pick a publish date/time. The calendar page lets you drag for fine
            adjustment afterward.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="schedule-when">When</Label>
          <Input
            id="schedule-when"
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? "Scheduling…" : "Schedule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function defaultLocal(): string {
  const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
