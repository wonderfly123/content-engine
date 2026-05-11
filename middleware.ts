import { NextResponse, type NextRequest } from "next/server";

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

export function middleware(req: NextRequest) {
  const user = process.env.BASIC_AUTH_USER;
  const pass = process.env.BASIC_AUTH_PASSWORD;

  if (!user || !pass) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "[middleware] BASIC_AUTH_USER/PASSWORD not set — allowing through in dev.",
      );
      return NextResponse.next();
    }
    return new NextResponse("Server misconfigured: basic auth not set.", {
      status: 500,
    });
  }

  const header = req.headers.get("authorization");
  if (header?.startsWith("Basic ")) {
    try {
      const decoded = atob(header.slice(6));
      const idx = decoded.indexOf(":");
      if (idx !== -1) {
        const u = decoded.slice(0, idx);
        const p = decoded.slice(idx + 1);
        if (timingSafeEqual(u, user) && timingSafeEqual(p, pass)) {
          return NextResponse.next();
        }
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
