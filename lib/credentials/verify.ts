/**
 * Tests a key against its service with one cheap, read-only call.
 * Used when a key is entered and by the hourly health check.
 */
import type { CredentialProvider } from "@/lib/db/enums";

export type VerifyResult = { ok: true } | { ok: false; error: string; /** True when the service itself rejected the key. */ rejected: boolean };

const CHECKS: Record<CredentialProvider, (secret: string) => { url: string; headers: Record<string, string> }> = {
  anthropic: (secret) => ({ url: "https://api.anthropic.com/v1/models?limit=1", headers: { "x-api-key": secret, "anthropic-version": "2023-06-01" } }),
  firecrawl: (secret) => ({ url: "https://api.firecrawl.dev/v1/team/credit-usage", headers: { authorization: `Bearer ${secret}` } }),
  apify: (secret) => ({ url: "https://api.apify.com/v2/users/me", headers: { authorization: `Bearer ${secret}` } }),
};

export async function verifyCredential(provider: CredentialProvider, secret: string, fetchImpl: typeof fetch = fetch): Promise<VerifyResult> {
  const { url, headers } = CHECKS[provider](secret);
  let res: Response;
  try {
    res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(15_000) });
  } catch (err) {
    return { ok: false, rejected: false, error: `Could not reach the service: ${(err as Error).message}` };
  }
  if (res.ok) return { ok: true };
  if (res.status === 401 || res.status === 403) return { ok: false, rejected: true, error: "The service rejected this key." };
  return { ok: false, rejected: false, error: `The service answered ${res.status}; could not confirm the key.` };
}
