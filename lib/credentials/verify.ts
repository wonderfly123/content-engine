/**
 * Tests a key against its service with one cheap, read-only call.
 * Used when a key is entered and by the hourly health check.
 */
import type { CredentialProvider } from "@/lib/db/enums";

export type VerifyResult = { ok: true } | { ok: false; error: string; /** True when the service itself rejected the key. */ rejected: boolean };

/** Epidemic Sound's MCP server (same address as MCP_URL in workers/editor/epidemic.py). */
export const EPIDEMIC_SOUND_MCP_URL = "https://www.epidemicsound.com/a/mcp-service/mcp";

const CHECKS: Record<CredentialProvider, (secret: string) => { url: string; headers: Record<string, string>; method?: "POST"; body?: string }> = {
  anthropic: (secret) => ({ url: "https://api.anthropic.com/v1/models?limit=1", headers: { "x-api-key": secret, "anthropic-version": "2023-06-01" } }),
  // Opening a session is the cheapest call the MCP server has; a bad or expired key answers 401.
  epidemic_sound: (secret) => ({
    url: EPIDEMIC_SOUND_MCP_URL,
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "nekter", version: "1" } },
    }),
  }),
};

export async function verifyCredential(provider: CredentialProvider, secret: string, fetchImpl: typeof fetch = fetch): Promise<VerifyResult> {
  const { url, headers, method, body } = CHECKS[provider](secret);
  let res: Response;
  try {
    res = await fetchImpl(url, { method, headers, body, signal: AbortSignal.timeout(15_000) });
  } catch (err) {
    return { ok: false, rejected: false, error: `Could not reach the service: ${(err as Error).message}` };
  }
  // The status is all that is needed; an event-stream answer is not read.
  void res.body?.cancel().catch(() => {});
  if (res.ok) return { ok: true };
  if (res.status === 401 || res.status === 403) return { ok: false, rejected: true, error: "The service rejected this key." };
  return { ok: false, rejected: false, error: `The service answered ${res.status}; could not confirm the key.` };
}
