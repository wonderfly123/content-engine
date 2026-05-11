"use client";

import { Calendar, Check, Pencil, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export interface BriefRow {
  id: string;
  brandId: string;
  channel: string;
  format: string;
  title: string;
  hook: string;
  angle: string;
  keyMessage: string;
  suggestedHashtags: string[];
  suggestedCta: string | null;
  targetPublishDate: string | null;
  status:
    | "pending_review"
    | "approved"
    | "edited"
    | "rejected";
  rejectionReason: string | null;
  createdAt: string;
}

interface BriefCardProps {
  brief: BriefRow;
  onApprove?: (b: BriefRow) => void;
  onEdit?: (b: BriefRow) => void;
  onReject?: (b: BriefRow) => void;
  busy?: boolean;
}

export function BriefCard({
  brief,
  onApprove,
  onEdit,
  onReject,
  busy,
}: BriefCardProps) {
  const reviewable = brief.status === "pending_review" || brief.status === "edited";
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="truncate text-base">{brief.title}</CardTitle>
            <CardDescription className="mt-1 line-clamp-2">
              {brief.hook || brief.keyMessage || "No hook yet."}
            </CardDescription>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Badge variant="secondary" className="capitalize">
              {brief.channel}
            </Badge>
            <Badge variant="outline" className="capitalize">
              {brief.format}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {brief.angle && (
          <p className="mb-2 text-sm">
            <span className="font-medium">Angle: </span>
            <span className="text-muted-foreground">{brief.angle}</span>
          </p>
        )}
        {brief.targetPublishDate && (
          <p className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Calendar className="h-3 w-3" aria-hidden="true" />
            Target: {brief.targetPublishDate}
          </p>
        )}
        {brief.suggestedHashtags.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1">
            {brief.suggestedHashtags.slice(0, 6).map((h) => (
              <Badge key={h} variant="outline" className="text-xs">
                #{h}
              </Badge>
            ))}
          </div>
        )}
        {brief.status === "rejected" && brief.rejectionReason && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
            Rejected: {brief.rejectionReason}
          </p>
        )}
        {reviewable && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={() => onApprove?.(brief)}
              disabled={busy}
              aria-label={`Approve brief: ${brief.title}`}
            >
              <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onEdit?.(brief)}
              disabled={busy}
              aria-label={`Edit brief: ${brief.title}`}
            >
              <Pencil className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              Edit
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onReject?.(brief)}
              disabled={busy}
              aria-label={`Reject brief: ${brief.title}`}
            >
              <X className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              Reject
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
