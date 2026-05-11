/**
 * LLM provider factory. Service-layer code imports from `@/lib/llm`, never
 * from `@anthropic-ai/sdk` directly, so a future provider (OpenAI, etc.) can
 * swap in via the `LLM_PROVIDER` env var without churn.
 */

import { AnthropicProvider } from './anthropic';
import type { LLMProvider } from './types';

export * from './types';
export { AnthropicProvider, DEFAULT_MODEL, NUANCED_MODEL } from './anthropic';

let cached: LLMProvider | undefined;

export function getLLMProvider(): LLMProvider {
  if (cached) return cached;
  const provider = (process.env.LLM_PROVIDER ?? 'anthropic').toLowerCase();
  switch (provider) {
    case 'anthropic':
      cached = new AnthropicProvider();
      return cached;
    default:
      throw new Error(
        `Unsupported LLM_PROVIDER="${provider}". Supported: anthropic.`,
      );
  }
}

/** Reset the cached provider — useful in tests. */
export function __resetLLMProvider(): void {
  cached = undefined;
}
