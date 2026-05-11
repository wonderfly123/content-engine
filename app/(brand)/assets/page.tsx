"use client";

import { useEffect, useMemo, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UploadZone } from "@/components/assets/upload-zone";
import { AssetGrid } from "@/components/assets/asset-grid";
import { AssetFilterBar } from "@/components/assets/asset-filter-bar";
import type { AssetRow } from "@/components/assets/asset-card";
import { useBrandStore } from "@/lib/stores/brand-store";
import type { AssetKind } from "@/lib/db/enums";

export default function AssetsPage() {
  const brand = useBrandStore((s) => s.active);
  const [tab, setTab] = useState<"library" | "pending">("library");
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [kind, setKind] = useState<AssetKind | null>(null);
  const [search, setSearch] = useState("");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!brand) return;
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({ brandId: brand.id });
    if (tab === "pending") params.set("pending", "true");
    fetch(`/api/assets?${params.toString()}`)
      .then(async (r) => (r.ok ? r.json() : { assets: [] }))
      .then((d: { assets: AssetRow[] }) => {
        if (!cancelled) setAssets(d.assets);
      })
      .catch(() => {
        if (!cancelled) setAssets([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [brand, tab, reloadToken]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    assets.forEach((a) => a.tags.forEach((t) => set.add(t)));
    return Array.from(set).sort();
  }, [assets]);

  const filtered = useMemo(() => {
    return assets.filter((a) => {
      if (kind && a.kind !== kind) return false;
      if (selectedTag && !a.tags.includes(selectedTag)) return false;
      if (
        search &&
        !a.label.toLowerCase().includes(search.toLowerCase())
      )
        return false;
      return true;
    });
  }, [assets, kind, selectedTag, search]);

  if (!brand) {
    return <p className="text-sm text-muted-foreground">No brand selected.</p>;
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Assets</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Brand-scoped media library. Upload, tag, and attach to drafts.
        </p>
      </div>

      <UploadZone
        brandId={brand.id}
        onUploaded={() => setReloadToken((n) => n + 1)}
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as "library" | "pending")}>
        <TabsList>
          <TabsTrigger value="library">Library</TabsTrigger>
          <TabsTrigger value="pending">Pending</TabsTrigger>
        </TabsList>

        <TabsContent value="library" className="space-y-4">
          <AssetFilterBar
            kind={kind}
            onKindChange={setKind}
            search={search}
            onSearchChange={setSearch}
            tags={allTags}
            selectedTag={selectedTag}
            onTagChange={setSelectedTag}
          />
          <AssetGrid
            assets={filtered}
            emptyMessage={loading ? "Loading…" : "No assets in library yet."}
          />
        </TabsContent>

        <TabsContent value="pending" className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Assets uploaded but not yet attached to any draft.
          </p>
          <AssetGrid
            assets={filtered}
            emptyMessage={loading ? "Loading…" : "Nothing pending."}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
