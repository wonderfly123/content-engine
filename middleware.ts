import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { accessFromClaims, decideAccess } from "@/lib/auth/access";
import { supabaseEnv } from "@/lib/supabase/env";

export const config = {
  // Run on everything except cron routes (they auth via CRON_SECRET header),
  // static assets, and Next internals.
  matcher: [
    "/((?!api/cron|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico)).*)",
  ],
};

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Optional outer gate: shared browser login, enforced only while BASIC_AUTH_USER/PASSWORD are set.
 * Kept in front of sign-in until the first admin account exists; remove the two env vars to drop it.
 */
function basicAuthFailure(req: NextRequest): NextResponse | null {
  const user = process.env.BASIC_AUTH_USER;
  const pass = process.env.BASIC_AUTH_PASSWORD;
  if (!user || !pass) return null;

  const header = req.headers.get("authorization");
  if (header?.startsWith("Basic ")) {
    try {
      const decoded = atob(header.slice(6));
      const idx = decoded.indexOf(":");
      if (idx !== -1 && timingSafeEqual(decoded.slice(0, idx), user) && timingSafeEqual(decoded.slice(idx + 1), pass)) {
        return null;
      }
    } catch {
      // fall through to 401
    }
  }
  return new NextResponse("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Content Engine"' },
  });
}

export async function middleware(req: NextRequest) {
  const blocked = basicAuthFailure(req);
  if (blocked) return blocked;

  const env = supabaseEnv();
  if (!env) {
    // Sign-in is not configured. Never serve the app wide open in production.
    if (process.env.NODE_ENV === "production" && !process.env.BASIC_AUTH_USER) {
      return new NextResponse("Server misconfigured: no sign-in method is set up.", { status: 500 });
    }
    return NextResponse.next();
  }

  // Refresh the session cookie and read the verified claims in one pass.
  let response = NextResponse.next({ request: req });
  const supabase = createServerClient(env.url, env.key, {
    cookies: {
      getAll() {
        return req.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => req.cookies.set(name, value));
        response = NextResponse.next({ request: req });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  // Do not run code between createServerClient and getClaims (Supabase guidance).
  const { data } = await supabase.auth.getClaims();
  const access = accessFromClaims(data?.claims as Record<string, unknown> | undefined);

  const decision = decideAccess(req.nextUrl.pathname, access);
  if (decision.kind === "allow") return response;
  if (decision.kind === "deny") {
    return NextResponse.json({ error: decision.message }, { status: decision.status });
  }
  const url = req.nextUrl.clone();
  url.pathname = decision.to;
  url.search = "";
  const redirect = NextResponse.redirect(url);
  // Carry any refreshed session cookies onto the redirect.
  response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
  return redirect;
}
