/**
 * LLM provider. Service-layer code imports from `@/lib/llm`, never from
 * `@anthropic-ai/sdk` directly. A provider is built per workspace with that
 * workspace's own key: see `llmForBrand` in `@/lib/credentials/clients`.
 */

export * from './types';
export { AnthropicProvider, DEFAULT_MODEL, NUANCED_MODEL } from './anthropic';
