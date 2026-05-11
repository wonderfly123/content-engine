"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { KindIcon, KIND_LABEL } from "./kind-icon";
import { AttachToDraftDialog } from "./attach-to-draft-dialog";
import type { AssetKind } from "@/lib/db/enums";

export interface AssetRow {
  id: string;
  brandId: string;
  kind: AssetKind;
  label: string;
  tags: string[];
  storageUrl: string;
  thumbnailUrl: string | null;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  archived: boolean;
  usageCount?: number;
}

interface Props {
  asset: AssetRow;
}

export function AssetCard({ asset }: Props) {
  const [attachOpen, setAttachOpen] = useState(false);

  return (
    <div className="group flex flex-col overflow-hidden rounded-lg border bg-card text-card-foreground">
      <Link
        href={`/assets/${asset.id}`}
        className="relative aspect-square bg-muted"
      >
        {asset.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={asset.thumbnailUrl}
            alt={asset.label || "asset"}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <KindIcon kind={asset.kind} className="h-10 w-10" />
          </div>
        )}
        {asset.durationSec != null && (
          <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-xs text-white">
            {formatDuration(asset.durationSec)}
          </span>
        )}
        {(asset.usageCount ?? 0) > 0 && (
          <Badge
            variant="secondary"
            className="absolute left-2 top-2 text-xs"
          >
            used {asset.usageCount}×
          </Badge>
        )}
      </Link>
      <div className="flex flex-col gap-2 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <KindIcon kind={asset.kind} />
            <span className="truncate text-sm font-medium">
              {asset.label || "(untitled)"}
            </span>
          </div>
          <span className="shrink-0 text-xs text-muted-foreground">
            {KIND_LABEL[asset.kind]}
          </span>
        </div>
        {(asset.width || asset.height) && (
          <p className="text-xs text-muted-foreground">
            {asset.width}×{asset.height}
          </p>
        )}
        {asset.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {asset.tags.slice(0, 3).map((t) => (
              <Badge key={t} variant="outline" className="text-xs">
                {t}
              </Badge>
            ))}
            {asset.tags.length > 3 && (
              <span className="text-xs text-muted-foreground">
                +{asset.tags.length - 3}
              </span>
            )}
          </div>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={() => setAttachOpen(true)}
        >
          Attach to draft
        </Button>
      </div>
      <AttachToDraftDialog
        open={attachOpen}
        onOpenChange={setAttachOpen}
        asset={asset}
      />
    </div>
  );
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60)
    .toString()
    .padStart(2, "0");
  return `${m}:${s}`;
}
