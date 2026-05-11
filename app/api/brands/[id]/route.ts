/**
 * /api/brands/[id]
 *   GET   → fetch one brand (used by onboarding wizard step components)
 *   PATCH → light updates (status, description, name, slug)
 *
 * Mutations that affect wizard state should prefer the server actions in
 * `app/onboarding/[brandId]/actions.ts` since those write `events` rows.
 */

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { brands, events } from "@/lib/db/schema";

export const runtime = "nodejs";

const idSchema = z.string().uuid();

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/)
    .optional(),
  description: z.string().trim().max(8000).optional(),
  status: z.enum(["draft", "active", "archived"]).optional(),
});

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const idParse = idSchema.safeParse(id);
  if (!idParse.success) {
    return NextResponse.json({ error: "Invalid brand id" }, { status: 400 });
  }

  try {
    const [row] = await db.select().from(brands).where(eq(brands.id, idParse.data));
    if (!row) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ brand: row });
  } catch (err) {
    return NextResponse.json(
      { error: "Read failed", detail: (err as Error).message },
      { status: 500 },
    );
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const idParse = idSchema.safeParse(id);
  if (!idParse.success) {
    return NextResponse.json({ error: "Invalid brand id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten() },
      { status: 422 },
    );
  }
  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  try {
    const [prev] = await db
      .select({ status: brands.status })
      .from(brands)
      .where(eq(brands.id, idParse.data));
    if (!prev) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const [updated] = await db
      .update(brands)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(brands.id, idParse.data))
      .returning();

    if (parsed.data.status && parsed.data.status !== prev.status) {
      await db.insert(events).values({
        entityType: "brand",
        entityId: idParse.data,
        fromStatus: prev.status,
        toStatus: parsed.data.status,
        actor: "user",
        note: "Patched via /api/brands/[id]",
      });
    }

    return NextResponse.json({ brand: updated });
  } catch (err) {
    return NextResponse.json(
      { error: "Update failed", detail: (err as Error).message },
      { status: 500 },
    );
  }
}
