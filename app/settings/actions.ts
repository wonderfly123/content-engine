"use server";

/**
 * Settings-tab server actions. Currently focused on Keywords (the one
 * brand-scoped surface that isn't covered by the onboarding action set).
 *
 * Other brand tabs reuse the existing actions in app/onboarding/[brandId]/actions.ts
 * (saveProfile, saveICPs, saveCompetitorsInspiration, saveCadence).
 */

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { keywords, events, jobs } from "@/lib/db/schema";

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const idSchema = z.string().uuid();

export async function addKeyword(input: {
  brandId: string;
  term: string;
}): Promise<ActionResult<{ id: string }>> {
  if (!idSchema.safeParse(input.brandId).success) {
    return { ok: false, error: "Invalid brand id" };
  }
  const term = input.term.trim();
  if (!term) return { ok: false, error: "Term is required" };
  if (term.length > 80) return { ok: false, error: "Term is too long" };
  const [row] = await db
    .insert(keywords)
    .values({ brandId: input.brandId, term, status: "active" })
    .returning({ id: keywords.id });
  if (!row) return { ok: false, error: "Insert failed" };
  await db.insert(events).values({
    entityType: "brand",
    entityId: input.brandId,
    actor: "user",
    note: `keyword added: ${term}`,
  });
  revalidatePath("/settings");
  return { ok: true, data: { id: row.id } };
}

export async function setKeywordStatus(input: {
  brandId: string;
  keywordId: string;
  status: "active" | "paused";
}): Promise<ActionResult<undefined>> {
  if (!idSchema.safeParse(input.keywordId).success) {
    return { ok: false, error: "Invalid keyword id" };
  }
  await db
    .update(keywords)
    .set({ status: input.status })
    .where(
      and(
        eq(keywords.id, input.keywordId),
        eq(keywords.brandId, input.brandId),
      ),
    );
  revalidatePath("/settings");
  return { ok: true, data: undefined };
}

export async function deleteKeyword(input: {
  brandId: string;
  keywordId: string;
}): Promise<ActionResult<undefined>> {
  if (!idSchema.safeParse(input.keywordId).success) {
    return { ok: false, error: "Invalid keyword id" };
  }
  await db
    .delete(keywords)
    .where(
      and(
        eq(keywords.id, input.keywordId),
        eq(keywords.brandId, input.brandId),
      ),
    );
  revalidatePath("/settings");
  return { ok: true, data: undefined };
}

export async function pullKeywordNow(input: {
  brandId: string;
  keywordId: string;
}): Promise<ActionResult<{ jobId: string }>> {
  if (!idSchema.safeParse(input.keywordId).success) {
    return { ok: false, error: "Invalid keyword id" };
  }
  const [row] = await db
    .insert(jobs)
    .values({
      kind: "research_pull",
      brandId: input.brandId,
      payloadJson: { source: "manual_keyword", keywordId: input.keywordId },
      status: "queued",
    })
    .returning({ id: jobs.id });
  if (!row) return { ok: false, error: "Failed to enqueue" };
  return { ok: true, data: { jobId: row.id } };
}
