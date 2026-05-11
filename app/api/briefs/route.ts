/**
 * /api/briefs
 *   GET  ?brandId=&status=&channel=  → list briefs (filtered)
 *   POST  → create a manual brief for a brand
 */

import { NextResponse, type NextRequest } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { briefs, events } from "@/lib/db/schema";
import {
  briefStatusValues,
  channelValues,
  formatValues,
} from "@/lib/db/enums";

export const runtime = "nodejs";

const listQuerySchema = z.object({
  brandId: z.string().uuid().optional(),
  status: z.enum(briefStatusValues).optional(),
  channel: z.enum(channelValues).optional(),
});

const createSchema = z.object({
  brandId: z.string().uuid(),
  channel: z.enum(channelValues),
  format: z.enum(formatValues),
  title: z.string().min(1).max(200),
  hook: z.string().default(""),
  angle: z.string().default(""),
  keyMessage: z.string().default(""),
  suggestedHashtags: z.array(z.string()).default([]),
  suggestedCta: z.string().optional(),
  targetPublishDate: z.string().optional(),
  icpId: z.string().uuid().optional(),
});

export async function GET(req: NextRequest): Promise<NextResponse> {
  const q = Object.fromEntries(req.nextUrl.searchParams.entries());
  const parsed = listQuerySchema.safeParse(q);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_query", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { brandId, status, channel } = parsed.data;
  const conds = [];
  if (brandId) conds.push(eq(briefs.brandId, brandId));
  if (status) conds.push(eq(briefs.status, status));
  if (channel) conds.push(eq(briefs.channel, channel));
  const rows = await db
    .select()
    .from(briefs)
    .where(conds.length > 0 ? and(...conds) : undefined)
    .orderBy(desc(briefs.createdAt));
  return NextResponse.json({ briefs: rows });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const json = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const v = parsed.data;
  const [row] = await db
    .insert(briefs)
    .values({
      brandId: v.brandId,
      channel: v.channel,
      format: v.format,
      title: v.title,
      hook: v.hook,
      angle: v.angle,
      keyMessage: v.keyMessage,
      suggestedHashtags: v.suggestedHashtags,
      suggestedCta: v.suggestedCta ?? null,
      targetPublishDate: v.targetPublishDate ?? null,
      icpId: v.icpId ?? null,
      status: "pending_review",
    })
    .returning();
  if (!row) {
    return NextResponse.json({ error: "insert_failed" }, { status: 500 });
  }
  await db.insert(events).values({
    entityType: "brief",
    entityId: row.id,
    toStatus: "pending_review",
    actor: "user",
    note: "manual brief created",
  });
  return NextResponse.json({ brief: row }, { status: 201 });
}
