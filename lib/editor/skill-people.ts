/**
 * Names (emails) for the admins who saved skill versions, for Admin's history list. Looked up in
 * Supabase auth; anyone it can't find shows as a short id, and the caller shows as "you".
 */
export async function namesFor(userIds: string[], youId: string): Promise<(id: string) => string> {
  const names = new Map<string, string>();
  const others = [...new Set(userIds)].filter((id) => id !== youId);
  if (others.length > 0) {
    try {
      const { createAdminClient } = await import("@/lib/supabase/server");
      const admin = createAdminClient();
      await Promise.all(
        others.map(async (id) => {
          const { data } = await admin.auth.admin.getUserById(id);
          if (data?.user?.email) names.set(id, data.user.email);
        }),
      );
    } catch {
      // Names are a nicety: fall back to ids.
    }
  }
  return (id) => (id === youId ? "you" : names.get(id) ?? `user ${id.slice(0, 8)}`);
}
