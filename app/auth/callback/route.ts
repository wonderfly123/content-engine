import { NextResponse, type NextRequest } from "next/server";
import { finishSignIn } from "@/lib/auth/finish-sign-in";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Google, and the link in a confirmation email, send the user back here. Exchange the code for
 * a session, then set the person up if this is their first time.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const url = request.nextUrl.clone();
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next");
  const fail = (reason: string) => {
    url.pathname = "/login";
    url.search = `?error=${reason}`;
    return NextResponse.redirect(url);
  };
  if (!code) return fail("1");

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) return fail("1");

  const to = await finishSignIn(supabase, data.user, next);
  if (!to) return fail("setup");
  url.pathname = to;
  url.search = "";
  return NextResponse.redirect(url);
}
