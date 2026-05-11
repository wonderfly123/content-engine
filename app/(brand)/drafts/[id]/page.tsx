import { notFound } from "next/navigation";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { assets, draftAssets, drafts } from "@/lib/db/schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DraftPreviewReel } from "@/components/drafts/draft-preview-reel";
import { DraftPreviewCarousel } from "@/components/drafts/draft-preview-carousel";
import { DraftPreviewImage } from "@/components/drafts/draft-preview-image";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function DraftDetailPage({ params }: PageProps) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [draft] = await db.select().from(drafts).where(eq(drafts.id, id));
  if (!draft) notFound();

  const attached = await db
    .select({
      assetId: draftAssets.assetId,
      slotIndex: draftAssets.slotIndex,
      role: draftAssets.role,
      label: assets.label,
      kind: assets.kind,
      thumbnailUrl: assets.thumbnailUrl,
      storageUrl: assets.storageUrl,
    })
    .from(draftAssets)
    .innerJoin(assets, eq(draftAssets.assetId, assets.id))
    .where(eq(draftAssets.draftId, id));

  const title = draft.metaJson?.title ?? "Draft";

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <Button asChild variant="ghost" size="sm">
        <Link href="/drafts">← Back to drafts</Link>
      </Button>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Brief: <code className="font-mono text-xs">{draft.briefId}</code>
          </p>
        </div>
        <div className="flex gap-1">
          <Badge variant="secondary" className="capitalize">
            {draft.channel}
          </Badge>
          <Badge variant="outline" className="capitalize">
            {draft.format}
          </Badge>
          <Badge>{draft.status}</Badge>
        </div>
      </div>

      {draft.format === "reel" && (
        <DraftPreviewReel scriptJson={draft.scriptJson} caption={draft.caption} />
      )}
      {draft.format === "carousel" && (
        <DraftPreviewCarousel
          slideJson={draft.slideJson}
          caption={draft.caption}
        />
      )}
      {draft.format === "image" && (
        <DraftPreviewImage
          caption={draft.caption}
          imagePrompts={draft.imagePrompts}
        />
      )}
      {!["reel", "carousel", "image"].includes(draft.format) && (
        <Card>
          <CardHeader>
            <CardTitle>Caption</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm">{draft.caption}</p>
            {draft.body && (
              <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">
                {draft.body}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Attached assets</CardTitle>
        </CardHeader>
        <CardContent>
          {attached.length === 0 ? (
            <p className="text-sm text-muted-foreground">No assets attached.</p>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {attached.map((a) => (
                <li
                  key={`${a.assetId}-${a.slotIndex}`}
                  className="overflow-hidden rounded-md border"
                >
                  <div className="aspect-square bg-muted">
                    {a.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={a.thumbnailUrl}
                        alt={a.label || "Asset"}
                        className="h-full w-full object-cover"
                      />
                    ) : null}
                  </div>
                  <div className="p-2">
                    <p className="truncate text-xs">{a.label || a.assetId}</p>
                    <p className="text-[10px] text-muted-foreground">
                      slot {a.slotIndex} · {a.role}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {draft.rejectionReason && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base text-destructive">Rejected</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">{draft.rejectionReason}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
