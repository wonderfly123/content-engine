"use client";

import { useEffect, useState, use } from "react";
import { toast } from "sonner";
import { Archive, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { KindIcon, KIND_LABEL } from "@/components/assets/kind-icon";
import type { AssetRow } from "@/components/assets/asset-card";

interface UsedByRow {
  draftId: string;
  channel: string;
  format: string;
  slotIndex: number;
  role: string;
}

export default function AssetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [asset, setAsset] = useState<AssetRow | null>(null);
  const [usedBy, setUsedBy] = useState<UsedByRow[]>([]);
  const [label, setLabel] = useState("");
  const [tags, setTags] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`/api/assets/${id}`)
      .then(async (r) => (r.ok ? r.json() : null))
      .then(
        (
          d: {
            asset: AssetRow;
            usedBy?: UsedByRow[];
          } | null,
        ) => {
          if (!d) return;
          setAsset(d.asset);
          setUsedBy(d.usedBy ?? []);
          setLabel(d.asset.label);
          setTags(d.asset.tags.join(", "));
        },
      );
  }, [id]);

  async function save() {
    setSaving(true);
    const res = await fetch(`/api/assets/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        label,
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      }),
    });
    setSaving(false);
    if (res.ok) {
      const d = (await res.json()) as { asset: AssetRow };
      setAsset(d.asset);
      toast.success("Saved");
    } else {
      toast.error("Save failed");
    }
  }

  async function archive() {
    if (!confirm("Archive this asset?")) return;
    const res = await fetch(`/api/assets/${id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Archived");
      const d = (await res.json()) as { asset: AssetRow };
      setAsset(d.asset);
    }
  }

  if (!asset) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link
        href="/assets"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to library
      </Link>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="overflow-hidden rounded-lg border bg-muted">
          {asset.kind === "video" ? (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video
              src={asset.storageUrl}
              controls
              className="aspect-square w-full bg-black object-contain"
            />
          ) : asset.kind === "audio" ? (
            <div className="flex aspect-square w-full items-center justify-center">
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <audio src={asset.storageUrl} controls className="w-full px-4" />
            </div>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={asset.storageUrl}
              alt={asset.label}
              className="aspect-square w-full object-contain"
            />
          )}
        </div>

        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <KindIcon kind={asset.kind} />
            <span className="text-sm text-muted-foreground">
              {KIND_LABEL[asset.kind]}
            </span>
            {asset.archived && <Badge variant="secondary">Archived</Badge>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="label">Label</Label>
            <Input
              id="label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tags">Tags (comma-separated)</Label>
            <Input
              id="tags"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
            />
          </div>

          <dl className="grid grid-cols-2 gap-2 text-sm">
            {asset.width && (
              <>
                <dt className="text-muted-foreground">Dimensions</dt>
                <dd>
                  {asset.width}×{asset.height}
                </dd>
              </>
            )}
            {asset.durationSec != null && (
              <>
                <dt className="text-muted-foreground">Duration</dt>
                <dd>{asset.durationSec}s</dd>
              </>
            )}
            <dt className="text-muted-foreground">Used by</dt>
            <dd>{asset.usageCount ?? usedBy.length} draft(s)</dd>
          </dl>

          <div className="flex gap-2">
            <Button onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
            {!asset.archived && (
              <Button variant="outline" onClick={archive}>
                <Archive className="mr-1 h-4 w-4" />
                Archive
              </Button>
            )}
          </div>
        </div>
      </div>

      {usedBy.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-medium">Used by</h3>
          <ul className="rounded-lg border">
            {usedBy.map((u) => (
              <li
                key={`${u.draftId}-${u.slotIndex}`}
                className="flex items-center justify-between border-b px-3 py-2 last:border-b-0 text-sm"
              >
                <span>
                  <Link
                    href={`/drafts/${u.draftId}`}
                    className="hover:underline"
                  >
                    {u.channel}/{u.format}
                  </Link>{" "}
                  · slot {u.slotIndex} · {u.role}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
