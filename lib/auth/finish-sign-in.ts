/**
 * The last step of every sign-in (Google return, email sign-in, first visit after confirming an
 * email): set the person up if needed, re-issue the session, and say where to send them.
 */
import "server-only";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/server";
import { ROLE_KEY, STATUS_KEY } from "./access";
import { provisionUser, type UserAdmin } from "./provision";

function supabaseUserAdmin(): UserAdmin {
  const admin = createAdminClient();
  return {
    async countActiveAdmins() {
      let admins = 0;
      for (let page = 1; page <= 50; page++) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
        if (error) throw error;
        admins += data.users.filter((u) => u.app_metadata?.[ROLE_KEY] === "admin" && u.app_metadata?.[STATUS_KEY] === "active").length;
        if (data.users.length < 200) break;
      }
      return admins;
    },
    async setAppMetadata(userId, appMetadata) {
      const { error } = await admin.auth.admin.updateUserById(userId, { app_metadata: appMetadata });
      if (error) throw error;
    },
  };
}

/** Only same-site paths; anything else falls back to the dashboard. */
export function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.includes("\\") ? next : "/dashboard";
}

/** Returns the path to send the user to, or null when set-up failed. */
export async function finishSignIn(supabase: SupabaseClient, user: User, next: string | null): Promise<string | null> {
  try {
    const result = await provisionUser(user, supabaseUserAdmin());
    // Re-issue the session so the new role and status are inside the token straight away.
    if (result.refreshSession) await supabase.auth.refreshSession();
    // A brand-new account has no brand yet: start with adding one.
    return result.isNew ? "/onboarding" : safeNext(next);
  } catch (err) {
    console.error("sign-in set-up failed:", err);
    return null;
  }
}
