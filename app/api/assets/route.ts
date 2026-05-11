import { NextResponse, type NextRequest } from "next/server";
import { and, eq, desc, sql, ilike, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  assets,
  draftAssets,
  drafts,
} from "@/lib/db/schema";
import {
  createAssetRequestSchema,
  listAssetsQuerySchema,
} from "@/lib/assets/types";
import { probeUrl } from "@/lib/assets/probe";
import { validateAsset } from "@/lib/assets/validate";
import { generateThumbnail } from "@/lib/assets/thumbnail";

export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// GET /api/assets
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest): Promise<NextResponse> {
  const q = Object.fromEntries(req.nextUrl.searchParams.entries());
  const parsed = listAssetsQuerySchema.safeParse(q);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_query", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { brandId, kind, tag, search, archived, pending } = parsed.data;

  const conds = [eq(assets.brandId, brandId)];
  if (archived === "false") conds.push(eq(assets.archived, false));
  else if (archived === "true") conds.push(eq(assets.archived, true));
  if (kind) conds.push(eq(assets.kind, kind));
  if (tag) conds.push(sql`${assets.tags} && ARRAY[${tag}]::text[]`);
  if (search) conds.push(ilike(assets.label, `%${search}%`));
  if (pending === "true") {
    conds.push(
      sql`${assets.id} NOT IN (SELECT ${draftAssets.assetId} FROM ${draftAssets})`,
    );
  }

  const rows = await db
    .select()
    .from(assets)
    .where(and(...conds))
    .orderBy(desc(assets.createdAt));

  // Annotate each asset with usage count (cheap second query)
  const ids = rows.map((r) => r.id);
  let usage: Record<string, number> = {};
  if (ids.length > 0) {
    const counts = await db
      .select({
        assetId: draftAssets.assetId,
        count: sql<number>`count(*)::int`,
      })
      .from(draftAssets)
      .where(inArray(draftAssets.assetId, ids))
      .groupBy(draftAssets.assetId);
    usage = Object.fromEntries(counts.map((c) => [c.assetId, Number(c.count)]));
  }

  const enriched = rows.map((r) => ({ ...r, usageCount: usage[r.id] ?? 0 }));
  return NextResponse.json({ assets: enriched });
}

// ---------------------------------------------------------------------------
// POST /api/assets
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest): Promise<NextResponse> {
  const json = await req.json().catch(() => null);
  const parsed = createAssetRequestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const body = parsed.data;

  // 1) Probe + validate
  let probed;
  try {
    probed = await probeUrl(body.blobUrl);
  } catch (e) {
    return NextResponse.json(
      {
        error: "probe_failed",
        message: (e as Error).message,
      },
      { status: 422 },
    );
  }
  const mimeType =
    body.mimeType ?? inferMime(body.blobUrl, body.kind);
  const verdict = validateAsset({
    kind: body.kind,
    mimeType,
    probed,
  });
  if (!verdict.ok) {
    return NextResponse.json(
      { error: "validation_failed", ...verdict.error, metadata: verdict.metadata },
      { status: 422 },
    );
  }

  // 2) Generate thumbnail (image only — videos deferred per spec note).
  const thumb = await generateThumbnail(body.blobUrl, body.kind);

  // 3) Insert asset row
  const [inserted] = await db
    .insert(assets)
    .values({
      brandId: body.brandId,
      kind: body.kind,
      label: body.label ?? "",
      tags: body.tags ?? [],
      storageUrl: body.blobUrl,
      thumbnailUrl: thumb.url,
      durationSec: probed.durationSec
        ? Math.round(probed.durationSec)
        : null,
      width: probed.width ?? null,
      height: probed.height ?? null,
      mimeType,
      sizeBytes: probed.sizeBytes,
      source: "uploaded",
    })
    .returning();

  // 4) Optional draft_assets insert
  let attached = false;
  let draftTransitioned = false;
  if (body.draftId) {
    const slotIndex = body.slotIndex ?? 0;
    const role = body.role ?? "primary";
    await db.insert(draftAssets).values({
      draftId: body.draftId,
      assetId: inserted.id,
      slotIndex,
      role,
    });
    attached = true;
    draftTransitioned = await maybeTransitionDraft(body.draftId);
  }

  return NextResponse.json(
    {
      asset: inserted,
      attached,
      draftTransitioned,
      thumbNote: thumb.note,
    },
    { status: 201 },
  );
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function inferMime(url: string, kind: string): string {
  const lower = url.toLowerCase();
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".mov")) return "video/quicktime";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".wav")) return "audio/wav";
  return kind === "video"
    ? "video/mp4"
    : kind === "image"
      ? "image/jpeg"
      : "application/octet-stream";
}

/**
 * If a draft now has all required slots filled, transition it from
 * `awaiting_assets` to `awaiting_final_review`.
 *
 * Rules:
 *  - Reel/Image: at least one row with role='primary'
 *  - Carousel: at least 2 rows total
 *  - status must currently be 'awaiting_assets'
 *
 * Returns true if a transition happened.
 *
 * Note: Task 6 owns the draft state machine; this is an intentionally
 * narrow inline update guarded by the explicit conditions above.
 */
async function maybeTransitionDraft(draftId: string): Promise<boolean> {
  const [d] = await db
    .select({ status: drafts.status, format: drafts.format })
    .from(drafts)
    .where(eq(drafts.id, draftId));
  if (!d || d.status !== "awaiting_assets") return false;

  const rows = await db
    .select({
      slotIndex: draftAssets.slotIndex,
      role: draftAssets.role,
    })
    .from(draftAssets)
    .where(eq(draftAssets.draftId, draftId));

  const fullyAttached = isFullyAttached(d.format, rows);
  if (!fullyAttached) return false;

  await db
    .update(drafts)
    .set({ status: "awaiting_final_review" })
    .where(
      and(eq(drafts.id, draftId), eq(drafts.status, "awaiting_assets")),
    );
  return true;
}

function isFullyAttached(
  format: string,
  rows: Array<{ slotIndex: number; role: string }>,
): boolean {
  if (format === "reel" || format === "image") {
    return rows.some((r) => r.role === "primary");
  }
  if (format === "carousel") {
    return rows.length >= 2;
  }
  // Other formats don't require assets to advance status.
  return false;
}
