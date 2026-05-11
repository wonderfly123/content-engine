"use client";

import { AssetCard, type AssetRow } from "./asset-card";

interface Props {
  assets: AssetRow[];
  emptyMessage?: string;
}

export function AssetGrid({ assets, emptyMessage = "No assets yet." }: Props) {
  if (assets.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-dashed p-10 text-sm text-muted-foreground">
        {emptyMessage}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {assets.map((a) => (
        <AssetCard key={a.id} asset={a} />
      ))}
    </div>
  );
}
