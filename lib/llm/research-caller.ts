/**
 * A Messages API caller for requests that use Anthropic's server-side web tools (onboarding research).
 *
 * The installed SDK (0.39) predates the request fields used here (`web_fetch_20260209` /
 * `web_search_20260209`, adaptive thinking, `output_config`, `fallbacks`). The SDK sends the body
 * as given, so the request is passed through and the response read loosely by the caller.
 * Non-streaming on purpose: the reply is replayed unchanged after `pause_turn`, and this SDK's stream
 * accumulator does not rebuild server-tool blocks. 16k max tokens keeps it inside the SDK's timeout.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { MessagesCaller, ResearchMessage } from "@/lib/onboarding/research";

/** Server-side refusal fallback (`fallbacks: "default"` in the body). */
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export function researchCaller(apiKey: string): MessagesCaller {
  const client = new Anthropic({ apiKey, maxRetries: 1 });
  return async (body, { timeoutMs }) => {
    const res = await client.messages.create(body as unknown as Anthropic.MessageCreateParamsNonStreaming, {
      timeout: timeoutMs,
      headers: { "anthropic-beta": FALLBACK_BETA },
    });
    return res as unknown as ResearchMessage;
  };
}
