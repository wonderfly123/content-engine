export interface SupabaseEnv {
  url: string;
  key: string;
}

/** Public Supabase config, or null when not configured. */
export function supabaseEnv(): SupabaseEnv | null {
  // Literal property access so Next inlines these into client bundles.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  return url && key ? { url, key } : null;
}
