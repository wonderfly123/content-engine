/**
 * The one place that decides which brands a caller may touch.
 *
 * Rule: a signed-in, active user reaches a brand only through a `workspace_members` row for the
 * workspace that owns it. Being platform admin grants nothing here; it only opens Admin.
 *
 * Every API route is wrapped in `guard(...)` and calls one of the `require*` functions before it
 * reads or writes anything; server actions and pages use the `try*` forms. A brand or record the
 * caller cannot reach answers 404, the same as one that does not exist.
 * `lib/auth/__tests__/route-coverage.test.ts` fails when a route or action skips this.
 */
import { and, asc, eq } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import type { WorkspaceRole } from "@/lib/db/enums";
import type { Access } from "./access";
import { getAccess } from "./session";

export class AccessError extends Error {
  constructor(
    public readonly status: 401 | 403 | 404,
    message: string,
  ) {
    super(message);
    this.name = "AccessError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notFound = () => new AccessError(404, "Not found.");

export interface Membership {
  workspaceId: string;
  role: WorkspaceRole;
}

export interface WorkspaceAccess extends Membership {
  user: Access;
}

export interface BrandAccess extends WorkspaceAccess {
  brandId: string;
  slug: string;
  name: string;
}

/** The signed-in, active caller. */
export async function requireUser(): Promise<Access> {
  const access = await getAccess();
  if (!access) throw new AccessError(401, "Sign in required.");
  if (access.status !== "active") throw new AccessError(403, "Your access is not active.");
  return access;
}

/** The caller's workspaces (active ones only), oldest membership first. */
export async function listMemberships(userId: string): Promise<Membership[]> {
  return db
    .select({ workspaceId: schema.workspaceMembers.workspaceId, role: schema.workspaceMembers.role })
    .from(schema.workspaceMembers)
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.workspaceMembers.workspaceId))
    .where(and(eq(schema.workspaceMembers.userId, userId), eq(schema.workspaces.status, "active")))
    .orderBy(asc(schema.workspaceMembers.createdAt));
}

/** The workspace new brands are created in: the caller's first one. */
export async function requireWorkspace(): Promise<WorkspaceAccess> {
  const user = await requireUser();
  const [first] = await listMemberships(user.userId);
  if (!first) throw new AccessError(403, "You are not a member of a workspace.");
  return { user, ...first };
}

async function findBrand(user: Access, match: ReturnType<typeof eq>): Promise<BrandAccess> {
  const [row] = await db
    .select({
      brandId: schema.brands.id,
      slug: schema.brands.slug,
      name: schema.brands.name,
      workspaceId: schema.workspaceMembers.workspaceId,
      role: schema.workspaceMembers.role,
    })
    .from(schema.brands)
    .innerJoin(schema.workspaceMembers, eq(schema.workspaceMembers.workspaceId, schema.brands.workspaceId))
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.brands.workspaceId))
    .where(and(match, eq(schema.workspaceMembers.userId, user.userId), eq(schema.workspaces.status, "active")))
    .orderBy(asc(schema.workspaceMembers.createdAt))
    .limit(1);
  if (!row) throw notFound();
  return { user, ...row };
}

/** The caller's access to one brand, by id. Throws 404 when it is not theirs. */
export async function requireBrand(brandId: unknown): Promise<BrandAccess> {
  const user = await requireUser();
  if (typeof brandId !== "string" || !UUID.test(brandId)) throw notFound();
  return findBrand(user, eq(schema.brands.id, brandId));
}

/** The caller's access to one brand, by slug (slugs are only unique inside a workspace). */
export async function requireBrandBySlug(slug: unknown): Promise<BrandAccess> {
  const user = await requireUser();
  if (typeof slug !== "string" || !slug) throw notFound();
  return findBrand(user, eq(schema.brands.slug, slug));
}

/** Any table whose rows belong to a brand. */
export type BrandOwnedTable = PgTable & { id: PgColumn; brandId: PgColumn };

/**
 * The caller's access to one record (brief, draft, post, asset, ...), checked through the brand it
 * belongs to. Throws 404 when the record is missing or belongs to someone else.
 */
export async function requireOwned(table: BrandOwnedTable, id: unknown): Promise<BrandAccess> {
  const user = await requireUser();
  if (typeof id !== "string" || !UUID.test(id)) throw notFound();
  const [row] = await db.select({ brandId: table.brandId }).from(table).where(eq(table.id, id)).limit(1);
  if (!row || typeof row.brandId !== "string") throw notFound();
  return findBrand(user, eq(schema.brands.id, row.brandId));
}

/** Ids of every brand the caller can reach, for lists that span brands. */
export async function listBrandIds(): Promise<string[]> {
  const user = await requireUser();
  const rows = await db
    .select({ id: schema.brands.id })
    .from(schema.brands)
    .innerJoin(schema.workspaceMembers, eq(schema.workspaceMembers.workspaceId, schema.brands.workspaceId))
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.brands.workspaceId))
    .where(and(eq(schema.workspaceMembers.userId, user.userId), eq(schema.workspaces.status, "active")));
  return rows.map((r) => r.id);
}

/**
 * Reel jobs on this machine's disk (the local video workflow) belong to whoever runs the machine,
 * so only the platform admin may read them. Cloud jobs will carry a workspace of their own.
 */
export async function requireLocalReels(): Promise<Access> {
  const user = await requireUser();
  if (user.role !== "admin") throw notFound();
  return user;
}

async function orNull<T>(check: () => Promise<T>): Promise<T | null> {
  try {
    return await check();
  } catch (err) {
    if (err instanceof AccessError) return null;
    throw err;
  }
}

/** `requireBrand` for server actions and pages: null instead of throwing. */
export const tryBrand = (brandId: unknown): Promise<BrandAccess | null> => orNull(() => requireBrand(brandId));

/** `requireOwned` for server actions and pages: null instead of throwing. */
export const tryOwned = (table: BrandOwnedTable, id: unknown): Promise<BrandAccess | null> => orNull(() => requireOwned(table, id));

/** `requireWorkspace` for server actions and pages: null instead of throwing. */
export const tryWorkspace = (): Promise<WorkspaceAccess | null> => orNull(() => requireWorkspace());

/** Wraps a route handler so a failed access check becomes its 401 / 403 / 404 response. */
export function guard<A extends unknown[]>(handler: (...args: A) => Promise<Response> | Response): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    try {
      return await handler(...args);
    } catch (err) {
      if (err instanceof AccessError) return NextResponse.json({ error: err.message }, { status: err.status });
      throw err;
    }
  };
}
