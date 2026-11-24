import "server-only";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { accessFromClaims, bearerFrom, type Access } from "./access";

/**
 * The verified caller, or null. Use inside routes that need to know who is asking.
 * The browser is known by its session cookies; the native app by a bearer token.
 */
export async function getAccess(): Promise<Access | null> {
  const supabase = await createClient();
  const bearer = bearerFrom((await headers()).get("authorization"));
  // A malformed token makes getClaims throw; that is simply "not signed in".
  const { data } = bearer ? await supabase.auth.getClaims(bearer).catch(() => ({ data: null })) : await supabase.auth.getClaims();
  return accessFromClaims(data?.claims as Record<string, unknown> | undefined);
}

/** Throws unless the caller is an active admin. The middleware already enforces this; routes re-check. */
export async function requireAdmin(): Promise<Access> {
  const access = await getAccess();
  if (!access || access.status !== "active" || access.role !== "admin") throw new Error("Admins only.");
  return access;
}
