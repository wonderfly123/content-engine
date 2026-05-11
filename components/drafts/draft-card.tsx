"use client";

import Link from "next/link";
import { Check, ExternalLink, Image as ImageIcon, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ScheduleButton } from "./schedule-button";

export interface DraftRow {
  id: string;
  briefId: string;
  brandId: string;
  channel: string;
  format: string;
  caption: string;
  status:
    | "pending_review"
    | "edited"
    | "approved"
    | "rejected"
    | "awaiting_assets"
    | "awaiting_final_review"
    | "scheduled";
  rejectionReason: string | null;
  metaJson: { title?: string };
  createdAt: string;
}

interface DraftCardProps {
  draft: DraftRow;
  onApprove?: (d: DraftRow) => void;
  onReject?: (d: DraftRow) => void;
  onAttach?: (d: DraftRow) => void;
  /** Optional callback fired after scheduling succeeds. */
  onScheduled?: () => void;
  busy?: boolean;
}

export function DraftCard({
  draft,
  onApprove,
  onReject,
  onAttach,
  onScheduled,
  busy,
}: DraftCardProps) {
  const title = draft.metaJson?.title ?? draft.caption.slice(0, 60) ?? "Draft";
  const reviewable =
    draft.status === "pending_review" || draft.status === "edited";
  const needsAssets = draft.status === "awaiting_assets";
  const readyToSchedule = draft.status === "awaiting_final_review";

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="truncate text-base">{title}</CardTitle>
            <CardDescription className="mt-1 line-clamp-2">
              {draft.caption || "(no caption yet)"}
            </CardDescription>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Badge variant="secondary" className="capitalize">
              {draft.channel}
            </Badge>
            <Badge variant="outline" className="capitalize">
              {draft.format}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {draft.status === "rejected" && draft.rejectionReason && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
            Rejected: {draft.rejectionReason}
          </p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/drafts/${draft.id}`} aria-label={`Open draft: ${title}`}>
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              Open
            </Link>
          </Button>
          {reviewable && (
            <>
              <Button
                size="sm"
                onClick={() => onApprove?.(draft)}
                disabled={busy}
                aria-label="Approve draft"
              >
                <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                Approve
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onReject?.(draft)}
                disabled={busy}
                aria-label="Reject draft"
              >
                <X className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                Reject
              </Button>
            </>
          )}
          {needsAssets && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onAttach?.(draft)}
              disabled={busy}
              aria-label="Attach asset from library"
            >
              <ImageIcon className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              Attach asset
            </Button>
          )}
          {readyToSchedule && (
            <ScheduleButton
              draftId={draft.id}
              disabled={busy}
              onScheduled={onScheduled}
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
}
