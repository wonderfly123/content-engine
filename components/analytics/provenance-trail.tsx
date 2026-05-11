"use client";

import {
  CheckCircle2,
  FileText,
  Image as ImageIcon,
  Lightbulb,
  Send,
  Calendar as CalendarIcon,
  BarChart3,
} from "lucide-react";
import { format } from "date-fns";

export interface ProvenanceEvent {
  id: string;
  entityType: string;
  entityId: string;
  fromStatus: string | null;
  toStatus: string | null;
  actor: "system" | "user";
  note: string | null;
  at: string;
}

/**
 * Vertical timeline component. Renders the chain:
 *   1. Brief approved
 *   2. Inspiration sources used
 *   3. Draft generated → edits → approved
 *   4. Assets uploaded
 *   5. Scheduled
 *   6. Published
 */
export function ProvenanceTrail({
  events,
  briefTitle,
  inspirationHandles = [],
  assetCount = 0,
}: {
  events: ProvenanceEvent[];
  briefTitle?: string;
  inspirationHandles?: string[];
  assetCount?: number;
}) {
  // Sort oldest → newest.
  const sorted = [...events].sort(
    (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime(),
  );

  // Pick canonical milestone events.
  const briefApproved = sorted.find(
    (e) => e.entityType === "brief" && e.toStatus === "approved",
  );
  const draftCreated = sorted.find(
    (e) => e.entityType === "draft" && (e.toStatus === "pending_review" || e.note?.includes("Draft generated")),
  );
  const draftApproved = sorted.find(
    (e) => e.entityType === "draft" && e.toStatus === "approved",
  );
  const draftScheduled = sorted.find(
    (e) => e.entityType === "draft" && e.toStatus === "scheduled",
  );
  const postPublished = sorted.find(
    (e) => e.entityType === "post" && e.toStatus === "published",
  );

  const items = [
    briefApproved && {
      icon: FileText,
      title: "Brief approved",
      sub: briefTitle ?? briefApproved.note ?? undefined,
      at: briefApproved.at,
    },
    inspirationHandles.length > 0 && {
      icon: Lightbulb,
      title: "Inspiration referenced",
      sub: inspirationHandles.join(", "),
      at: briefApproved?.at,
    },
    draftCreated && {
      icon: FileText,
      title: "Draft generated",
      at: draftCreated.at,
    },
    draftApproved && {
      icon: CheckCircle2,
      title: "Draft approved",
      at: draftApproved.at,
    },
    assetCount > 0 && {
      icon: ImageIcon,
      title: `${assetCount} asset${assetCount === 1 ? "" : "s"} uploaded`,
      at: undefined,
    },
    draftScheduled && {
      icon: CalendarIcon,
      title: "Scheduled",
      sub: draftScheduled.note ?? undefined,
      at: draftScheduled.at,
    },
    postPublished && {
      icon: Send,
      title: "Published",
      at: postPublished.at,
    },
    {
      icon: BarChart3,
      title: "Analytics collected",
      sub: "Continually updating",
      at: undefined,
    },
  ].filter(Boolean) as Array<{
    icon: typeof FileText;
    title: string;
    sub?: string;
    at?: string;
  }>;

  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No provenance recorded yet.
      </p>
    );
  }

  return (
    <ol className="relative space-y-4 border-l pl-6">
      {items.map((it, i) => {
        const Icon = it.icon;
        return (
          <li key={i} className="relative">
            <span className="absolute -left-[31px] top-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full border bg-background">
              <Icon className="h-3 w-3" />
            </span>
            <div className="text-sm font-medium">{it.title}</div>
            {it.sub && (
              <div className="text-xs text-muted-foreground">{it.sub}</div>
            )}
            {it.at && (
              <div className="text-xs text-muted-foreground tabular-nums">
                {format(new Date(it.at), "PPP p")}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
