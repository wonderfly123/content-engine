import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { ROLE_KEY, STATUS_KEY, type Role, type Status } from "@/lib/auth/access";
import { requireAdmin } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface AdminUser {
  id: string;
  email: string;
  role: Role;
  status: Status;
  lastSignInAt: string | null;
  createdAt: string;
  isYou: boolean;
}

async function listAll(youId: string): Promise<AdminUser[]> {
  const admin = createAdminClient();
  const out: AdminUser[] = [];
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    for (const u of data.users) {
      const meta = (u.app_metadata ?? {}) as Record<string, unknown>;
      out.push({
        id: u.id,
        email: u.email ?? "",
        role: meta[ROLE_KEY] === "admin" ? "admin" : "user",
        status: meta[STATUS_KEY] === "active" || meta[STATUS_KEY] === "disabled" ? (meta[STATUS_KEY] as Status) : "pending",
        lastSignInAt: u.last_sign_in_at ?? null,
        createdAt: u.created_at,
        isYou: u.id === youId,
      });
    }
    if (data.users.length < 200) break;
  }
  const rank: Record<Status, number> = { pending: 0, active: 1, disabled: 2 };
  return out.sort((a, b) => rank[a.status] - rank[b.status] || a.email.localeCompare(b.email));
}

export async function GET(): Promise<NextResponse> {
  try {
    const me = await requireAdmin();
    return NextResponse.json({ users: await listAll(me.userId) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 403 });
  }
}

const patchSchema = z.object({
  id: z.string().uuid(),
  action: z.enum(["approve", "disable", "make_admin", "make_user"]),
});

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  let me;
  try {
    me = await requireAdmin();
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 403 });
  }
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid request" }, { status: 400 });
  const { id, action } = parsed.data;
  // An admin cannot lock themselves out or strip their own admin role.
  if (id === me.userId && (action === "disable" || action === "make_user")) {
    return NextResponse.json({ error: "You can't remove your own access. Ask another admin." }, { status: 400 });
  }
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.getUserById(id);
    if (error || !data.user) throw new Error("user not found");
    const meta = { ...(data.user.app_metadata ?? {}) } as Record<string, unknown>;
    if (action === "approve") meta[STATUS_KEY] = "active";
    if (action === "disable") meta[STATUS_KEY] = "disabled";
    if (action === "make_admin") { meta[ROLE_KEY] = "admin"; meta[STATUS_KEY] = "active"; }
    if (action === "make_user") meta[ROLE_KEY] = "user";
    if (!meta[ROLE_KEY]) meta[ROLE_KEY] = "user";
    const { error: updateError } = await admin.auth.admin.updateUserById(id, { app_metadata: meta });
    if (updateError) throw updateError;
    return NextResponse.json({ users: await listAll(me.userId) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
