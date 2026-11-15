import { NextResponse, type NextRequest } from "next/server";
import { finishSignIn } from "@/lib/auth/finish-sign-in";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Where a signed-in person lands when they have not been set up yet (email sign-in, or the
 * middleware finding an account with no access). Sets them up and sends them on.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const url = request.nextUrl.clone();
  const next = url.searchParams.get("next");
  url.search = "";

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) {
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  const to = await finishSignIn(supabase, data.user, next);
  if (!to) {
    url.pathname = "/login";
    url.search = "?error=setup";
    return NextResponse.redirect(url);
  }
  url.pathname = to;
  return NextResponse.redirect(url);
}
