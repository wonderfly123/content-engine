/**
 * Who may use the app. Two separate things decide what a person can do:
 *
 *  - Platform level (this file): `role` is "admin" for whoever runs the platform, "user" for
 *    everyone else; `status` is "active", "disabled", or "pending" (signed in but not set up yet).
 *  - Workspace level (lib/auth/workspace.ts): owner or staff of a workspace, which decides
 *    which brands they can touch. Platform admin grants nothing there.
 *
 * Role and status live in each user's Supabase `app_metadata`
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

/** Reads access from verified JWT claims. A signed-in user who has not been set up yet is `pending`. */
export function accessFromClaims(claims: Record<string, unknown> | null | undefined): Access | null {
  const sub = claims?.sub;
  if (typeof sub !== "string" || !sub) return null;
  const meta = (claims?.app_metadata ?? {}) as Record<string, unknown>;
  const role: Role = meta[ROLE_KEY] === "admin" ? "admin" : "user";
  const status: Status = meta[STATUS_KEY] === "active" || meta[STATUS_KEY] === "disabled" ? meta[STATUS_KEY] : "pending";
  return { userId: sub, email: typeof claims?.email === "string" ? claims.email : "", role, status };
}

/**
 * Which hostname serves what. The public website lives on the bare domain (nekter.io) and the app on
 * app.nekter.io. Any other host (the vercel.app address, localhost) serves both, as before.
 * Returns where to send a request that is on the wrong host, or null to carry on.
 */
export function hostRedirect(host: string, pathname: string, siteHost: string, appHost: string): string | null {
  const h = host.toLowerCase().split(":")[0];
  if (h === siteHost || h === `www.${siteHost}`) {
    // The website only has the public pages; everything else is the app.
    if (PUBLIC_PAGES.includes(pathname) || pathname.startsWith("/api/salesmsg/")) return null;
    return `https://${appHost}${pathname}`;
  }
  if (h === appHost && pathname === "/") return "/dashboard";
  if (h === appHost && PUBLIC_PAGES.includes(pathname)) return `https://${siteHost}${pathname}`;
  return null;
}

export type Decision =
  | { kind: "allow" }
  | { kind: "redirect"; to: string }
  | { kind: "deny"; status: 401 | 403; message: string };

// "/api/salesmsg/": Salesmsg's webhook has no session; it proves itself with a shared secret
// in ?token= (withSalesmsgToken in lib/conversations/texting.ts) and refuses everything else with 403.
// "/w/" and "/api/w/": watch links, the same way with their own key (withWatchLink / requireWatchLink).
// "/u/" and "/api/u/": upload links. The link's signed token is the key; the page and its upload
// routes check it (withUploadLink / requireUploadLink in lib/conversations/upload-link.ts), else 403/404.
// "/api/media/optimized" and "/api/media/frames": the optimizer worker's callbacks have no session either; they prove themselves
// with an HMAC of the body (withWorkerSignature in lib/media/worker-signature.ts), else 403.
// "/api/editor/uploads", "/api/editor/callback" and "/api/editor/progress": the editor worker has no session; it proves
// itself with MODAL_EDITOR_SECRET, as a bearer token for upload links and as an HMAC of the body for
// its result (withEditorBearer / withEditorSignature in lib/editor/worker-auth.ts), else 403.
const PUBLIC_PREFIXES = ["/login", "/auth/", "/api/salesmsg/", "/u/", "/api/u/", "/w/", "/api/w/", "/api/media/optimized", "/api/media/frames", "/api/editor/uploads", "/api/editor/callback", "/api/editor/progress"];
/** The public website: the landing page and the policy pages carriers and visitors read without signing in. */
export const PUBLIC_PAGES = ["/", "/privacy", "/terms", "/texting"];
/** Finishes a first sign-in (public: it checks the session itself). */
export const SETUP_PATH = "/auth/welcome";
const ADMIN_PREFIXES = ["/admin", "/api/admin"];
const matches = (pathname: string, prefixes: string[]) =>
  prefixes.some((p) => pathname === p || pathname === p.replace(/\/$/, "") || pathname.startsWith(p.endsWith("/") ? p : `${p}/`));

/** The single authorization rule for every request the middleware sees. */
export function decideAccess(pathname: string, access: Access | null): Decision {
  const isApi = pathname.startsWith("/api/");
  if (PUBLIC_PAGES.includes(pathname)) return { kind: "allow" };
  if (matches(pathname, PUBLIC_PREFIXES)) {
    // A signed-in, approved user has no business on the login page.
    if (pathname === "/login" && access?.status === "active") return { kind: "redirect", to: "/dashboard" };
    return { kind: "allow" };
  }
  if (!access) {
    return isApi ? { kind: "deny", status: 401, message: "Sign in required." } : { kind: "redirect", to: "/login" };
  }
  if (access.status === "pending") {
    // Signed in but not set up yet: /auth/welcome gives them their access and a workspace.
    return isApi ? { kind: "deny", status: 403, message: "Your account is not set up yet." } : { kind: "redirect", to: SETUP_PATH };
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
 * First sign-in: the very first account becomes the platform admin; everyone after that is an
 * ordinary user, active straight away (no approval step). `existingAdmins` is how many admins
 * exist right now. An admin can still disable an account later.
 */
export function initialAccess(existingAdmins: number): { role: Role; status: Status } {
  return { role: existingAdmins === 0 ? "admin" : "user", status: "active" };
}

/**
 * The access token a native app sends (`Authorization: Bearer <jwt>`), or null. The browser uses
 * session cookies instead; the token is verified the same way (supabase.auth.getClaims).
 */
export function bearerFrom(header: string | null | undefined): string | null {
  const m = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec((header ?? "").trim());
  return m ? m[1] : null;
}
