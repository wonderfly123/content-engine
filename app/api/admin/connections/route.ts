import { NextResponse } from "next/server";
import { asc } from "drizzle-orm";
import { AccessError, guard, requireUser } from "@/lib/auth/workspace";
import { checkConnections, listConnections } from "@/lib/connections/check";
import { db, schema } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface AdminBrand {
  id: string;
  name: string;
}

/** Every brand on the platform, so brands with nothing connected still show. Platform admin only. */
async function allBrands(): Promise<AdminBrand[]> {
  return db.select({ id: schema.brands.id, name: schema.brands.name }).from(schema.brands).orderBy(asc(schema.brands.name));
}

export const GET = guard(async (): Promise<NextResponse> => {
  if ((await requireUser()).role !== "admin") throw new AccessError(403, "Admins only.");
  return NextResponse.json({ connections: await listConnections(), brands: await allBrands() });
});

/** "Check now" from the Admin page. */
export const POST = guard(async (): Promise<NextResponse> => {
  if ((await requireUser()).role !== "admin") throw new AccessError(403, "Admins only.");
  return NextResponse.json({ connections: await checkConnections(), brands: await allBrands() });
});
