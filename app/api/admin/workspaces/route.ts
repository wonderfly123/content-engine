import { NextResponse, type NextRequest } from "next/server";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { AccessError, guard, requireUser } from "@/lib/auth/workspace";
import { db, schema } from "@/lib/db";
import { workspaceStatusValues } from "@/lib/db/enums";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface AdminWorkspace {
  id: string;
  name: string;
  status: "active" | "disabled";
  createdAt: string;
  members: Array<{ email: string; role: "owner" | "staff" }>;
  brands: number;
  storageBytes: number;
  /** True when the admin looking at the list belongs to this workspace. */
  isYours: boolean;
}

async function emailsById(): Promise<Map<string, string>> {
  const { createAdminClient } = await import("@/lib/supabase/server");
  const admin = createAdminClient();
  const out = new Map<string, string>();
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    for (const u of data.users) out.set(u.id, u.email ?? "");
    if (data.users.length < 200) break;
  }
  return out;
}

async function listAll(youId: string): Promise<AdminWorkspace[]> {
  const [workspaces, members, brandCounts, storage, emails] = await Promise.all([
    db.select().from(schema.workspaces),
    db.select().from(schema.workspaceMembers),
    db.select({ workspaceId: schema.brands.workspaceId, n: sql<number>`count(*)::int` }).from(schema.brands).groupBy(schema.brands.workspaceId),
    db
      .select({ workspaceId: schema.brands.workspaceId, bytes: sql<string>`coalesce(sum(${schema.assets.sizeBytes}), 0)` })
      .from(schema.assets)
      .innerJoin(schema.brands, eq(schema.brands.id, schema.assets.brandId))
      .groupBy(schema.brands.workspaceId),
    emailsById(),
  ]);
  return workspaces
    .map((w) => {
      const mine = members.filter((m) => m.workspaceId === w.id);
      return {
        id: w.id,
        name: w.name,
        status: w.status,
        createdAt: w.createdAt.toISOString(),
        members: mine.map((m) => ({ email: emails.get(m.userId) ?? "(unknown)", role: m.role })),
        brands: brandCounts.find((b) => b.workspaceId === w.id)?.n ?? 0,
        storageBytes: Number(storage.find((s) => s.workspaceId === w.id)?.bytes ?? 0),
        isYours: mine.some((m) => m.userId === youId),
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Every workspace on the platform. Platform admin only. */
export const GET = guard(async (): Promise<NextResponse> => {
  const me = await requireUser();
  if (me.role !== "admin") throw new AccessError(403, "Admins only.");
  return NextResponse.json({ workspaces: await listAll(me.userId) });
});

const patchSchema = z.object({ id: z.string().uuid(), status: z.enum(workspaceStatusValues) });

/** Disable or re-enable a workspace. A disabled workspace's members can reach none of its brands. */
export const PATCH = guard(async (req: NextRequest): Promise<NextResponse> => {
  const me = await requireUser();
  if (me.role !== "admin") throw new AccessError(403, "Admins only.");
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid request" }, { status: 400 });
  const { id, status } = parsed.data;
  if (status === "disabled") {
    const [own] = await db.select({ userId: schema.workspaceMembers.userId }).from(schema.workspaceMembers).where(sql`${schema.workspaceMembers.workspaceId} = ${id} and ${schema.workspaceMembers.userId} = ${me.userId}`).limit(1);
    if (own) return NextResponse.json({ error: "You can't disable a workspace you belong to." }, { status: 400 });
  }
  await db.update(schema.workspaces).set({ status, updatedAt: new Date() }).where(eq(schema.workspaces.id, id));
  return NextResponse.json({ workspaces: await listAll(me.userId) });
});
