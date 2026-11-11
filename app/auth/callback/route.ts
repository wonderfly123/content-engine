import { NextResponse, type NextRequest } from "next/server";
import { initialAccess, ROLE_KEY, STATUS_KEY } from "@/lib/auth/access";
import { createAdminClient, createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Only same-site paths; anything else falls back to the dashboard. */
function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.includes("\\") ? next : "/dashboard";
}

/** Google sends the user back here. Exchange the code for a session; give first-time users their access. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const url = request.nextUrl.clone();
  const code = url.searchParams.get("code");
  const next = safeNext(url.searchParams.get("next"));
  const fail = () => {
    url.pathname = "/login";
    url.search = "?error=1";
    return NextResponse.redirect(url);
  };
  if (!code) return fail();

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) return fail();

  const meta = (data.user.app_metadata ?? {}) as Record<string, unknown>;
  if (!meta[STATUS_KEY]) {
    try {
      const admin = createAdminClient();
      let admins = 0;
      for (let page = 1; page <= 20; page++) {
        const { data: list, error: listError } = await admin.auth.admin.listUsers({ page, perPage: 200 });
        if (listError) throw listError;
        admins += list.users.filter((u) => u.app_metadata?.[ROLE_KEY] === "admin" && u.app_metadata?.[STATUS_KEY] === "active").length;
        if (list.users.length < 200) break;
      }
      const first = initialAccess(admins);
      const { error: updateError } = await admin.auth.admin.updateUserById(data.user.id, {
        app_metadata: { ...meta, [ROLE_KEY]: first.role, [STATUS_KEY]: first.status },
      });
      if (updateError) throw updateError;
      // Re-issue the session so the new role and status are inside the token straight away.
      await supabase.auth.refreshSession();
    } catch {
      // Without a role the user simply lands on the pending page; an admin can approve them.
    }
  }

  url.pathname = next;
  url.search = "";
  return NextResponse.redirect(url);
}
