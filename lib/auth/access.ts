/**
 * Who may use the app. Role and status live in each user's Supabase `app_metadata`
 * (only the secret key can write it), so they arrive inside the verified session token
 * and the middleware can authorize without a database round trip.
 */
export type Role = "admin" | "user";
export type Status = "pending" | "active" | "disabled";

export interface Access {
  userId: string;
  email: string;
  role: Role;
  status: Status;
}

export const ROLE_KEY = "ce_role";
export const STATUS_KEY = "ce_status";

/** Reads access from verified JWT claims. A signed-in user with no role yet is `pending`. */
export function accessFromClaims(claims: Record<string, unknown> | null | undefined): Access | null {
  const sub = claims?.sub;
  if (typeof sub !== "string" || !sub) return null;
  const meta = (claims?.app_metadata ?? {}) as Record<string, unknown>;
  const role: Role = meta[ROLE_KEY] === "admin" ? "admin" : "user";
  const status: Status = meta[STATUS_KEY] === "active" || meta[STATUS_KEY] === "disabled" ? meta[STATUS_KEY] : "pending";
  return { userId: sub, email: typeof claims?.email === "string" ? claims.email : "", role, status };
}

export type Decision =
  | { kind: "allow" }
  | { kind: "redirect"; to: string }
  | { kind: "deny"; status: 401 | 403; message: string };

const PUBLIC_PREFIXES = ["/login", "/auth/"];
const ADMIN_PREFIXES = ["/admin", "/api/admin"];
const matches = (pathname: string, prefixes: string[]) =>
  prefixes.some((p) => pathname === p || pathname === p.replace(/\/$/, "") || pathname.startsWith(p.endsWith("/") ? p : `${p}/`));

/** The single authorization rule for every request the middleware sees. */
export function decideAccess(pathname: string, access: Access | null): Decision {
  const isApi = pathname.startsWith("/api/");
  if (matches(pathname, PUBLIC_PREFIXES)) {
    // A signed-in, approved user has no business on the login page.
    if (pathname === "/login" && access?.status === "active") return { kind: "redirect", to: "/dashboard" };
    return { kind: "allow" };
  }
  if (!access) {
    return isApi ? { kind: "deny", status: 401, message: "Sign in required." } : { kind: "redirect", to: "/login" };
  }
  if (access.status !== "active") {
    if (pathname === "/pending") return { kind: "allow" };
    return isApi ? { kind: "deny", status: 403, message: "Your access is not active." } : { kind: "redirect", to: "/pending" };
  }
  if (pathname === "/pending") return { kind: "redirect", to: "/dashboard" };
  if (matches(pathname, ADMIN_PREFIXES) && access.role !== "admin") {
    return isApi ? { kind: "deny", status: 403, message: "Admins only." } : { kind: "redirect", to: "/dashboard" };
  }
  return { kind: "allow" };
}

/**
 * First sign-in: the very first account becomes the active admin; everyone after that waits
 * for an admin to approve them. `existingAdmins` is how many admins exist right now.
 */
export function initialAccess(existingAdmins: number): { role: Role; status: Status } {
  return existingAdmins === 0 ? { role: "admin", status: "active" } : { role: "user", status: "pending" };
}
