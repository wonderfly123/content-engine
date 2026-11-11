import "server-only";
import { createClient } from "@/lib/supabase/server";
import { accessFromClaims, type Access } from "./access";

/** The verified caller, or null. Use inside routes that need to know who is asking. */
export async function getAccess(): Promise<Access | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return accessFromClaims(data?.claims as Record<string, unknown> | undefined);
}

/** Throws unless the caller is an active admin. The middleware already enforces this; routes re-check. */
export async function requireAdmin(): Promise<Access> {
  const access = await getAccess();
  if (!access || access.status !== "active" || access.role !== "admin") throw new Error("Admins only.");
  return access;
}
