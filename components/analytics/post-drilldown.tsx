"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LiveComments } from "./live-comments";
import { ProvenanceTrail, type ProvenanceEvent } from "./provenance-trail";
import { RetentionChart } from "./retention-chart";

export interface DrilldownData {
  post: {
    id: string;
    channel: string;
    status: string;
    publishedAt: string | null;
    scheduledFor: string;
    externalUrl: string | null;
  };
  draft: {
    id: string;
    caption: string;
    format: string;
  };
  brief: {
    id: string;
    title: string;
    angle: string;
    keyMessage: string;
    inspirationPostRefs: Array<{ externalUrl: string; why?: string }>;
  };
  icp: { id: string; name: string } | null;
  assets: Array<{
    slotIndex: number;
    role: "primary" | "cover" | "b_roll";
    asset: {
      id: string;
      kind: "video" | "image" | "audio" | "graphic";
      storageUrl: string;
      thumbnailUrl: string | null;
    };
  }>;
  snapshots: Array<{
    pulledAt: string;
    reach: number | null;
    impressions: number | null;
    likes: number | null;
    comments: number | null;
    shares: number | null;
    saves: number | null;
    watchTimeSec: number | null;
    videoViews: number | null;
    profileVisits: number | null;
    followsFromPost: number | null;
  }>;
  provenance: ProvenanceEvent[];
}

export function PostDrilldown({ data }: { data: DrilldownData }) {
  const latest = data.snapshots[data.snapshots.length - 1];
  const isReel = data.draft.format === "reel";

  return (
    <div className="space-y-6">
      <HeroBlock data={data} />
      <MetricsBlock latest={latest} />
      {isReel && <RetentionChart snapshots={data.snapshots} />}
      <LiveComments postId={data.post.id} />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Provenance trail</CardTitle>
          <CardDescription>
            The chain from brief → draft → assets → schedule → publish.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProvenanceTrail
            events={data.provenance}
            briefTitle={data.brief.title}
            inspirationHandles={data.brief.inspirationPostRefs.map(
              (r) => new URL(r.externalUrl).hostname,
            )}
            assetCount={data.assets.length}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function HeroBlock({ data }: { data: DrilldownData }) {
  const [captionOpen, setCaptionOpen] = useState(false);
  const longCaption = data.draft.caption.length > 280;
  const captionShown =
    captionOpen || !longCaption
      ? data.draft.caption
      : data.draft.caption.slice(0, 280) + "…";

  const primaryAsset = data.assets.find((a) => a.role === "primary") ?? data.assets[0];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{data.brief.title}</CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="outline" className="capitalize">
            {data.post.channel}
          </Badge>
          <Badge variant="outline" className="capitalize">
            {data.draft.format}
          </Badge>
          <Badge variant="outline" className="capitalize">
            {data.post.status}
          </Badge>
          {data.icp && (
            <Badge variant="secondary">ICP: {data.icp.name}</Badge>
          )}
          {data.post.externalUrl && (
            <Link
              href={data.post.externalUrl}
              target="_blank"
              rel="noreferrer"
              className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              View on platform <ExternalLink className="h-3 w-3" />
            </Link>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-[240px_1fr]">
        <div>
          {primaryAsset?.asset.kind === "video" ? (
            <video
              src={primaryAsset.asset.storageUrl}
              poster={primaryAsset.asset.thumbnailUrl ?? undefined}
              controls
              className="w-full rounded-md"
            />
          ) : primaryAsset ? (
            <Image
              src={primaryAsset.asset.thumbnailUrl ?? primaryAsset.asset.storageUrl}
              alt=""
              width={240}
              height={240}
              unoptimized
              className="aspect-square w-full rounded-md object-cover"
            />
          ) : (
            <div className="aspect-square w-full rounded-md bg-muted" />
          )}
          {data.assets.length > 1 && (
            <div className="mt-2 grid grid-cols-4 gap-1">
              {data.assets.slice(0, 8).map((a) => (
                <Image
                  key={a.asset.id}
                  src={a.asset.thumbnailUrl ?? a.asset.storageUrl}
                  alt=""
                  width={48}
                  height={48}
                  unoptimized
                  className="h-12 w-12 rounded object-cover"
                />
              ))}
            </div>
          )}
        </div>
        <div className="space-y-2 text-sm">
          <p className="whitespace-pre-wrap">{captionShown}</p>
          {longCaption && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCaptionOpen((v) => !v)}
              className="h-7 px-2 text-xs"
            >
              {captionOpen ? "Show less" : "Show more"}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function MetricsBlock({ latest }: { latest?: DrilldownData["snapshots"][number] }) {
  const items: Array<[string, string]> = [
    ["Reach", num(latest?.reach)],
    ["Impressions", num(latest?.impressions)],
    ["Likes", num(latest?.likes)],
    ["Comments", num(latest?.comments)],
    ["Shares", num(latest?.shares)],
    ["Saves", num(latest?.saves)],
    ["Video views", num(latest?.videoViews)],
    ["Watch time (s)", num(latest?.watchTimeSec)],
    ["Profile visits", num(latest?.profileVisits)],
    ["Follows from post", num(latest?.followsFromPost)],
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Performance</CardTitle>
        <CardDescription>Latest snapshot values.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {items.map(([label, value]) => (
            <div
              key={label}
              className="rounded-md border bg-card px-3 py-2"
            >
              <div className="text-xs text-muted-foreground">{label}</div>
              <div className="text-lg tabular-nums">{value}</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function num(v: number | null | undefined): string {
  if (v == null) return "—";
  return v.toLocaleString();
}
