/**
 * Builds the AI client for one brand, using the key of the workspace that owns it.
 * This is the only place the client gets a key; there is no shared environment key to fall back on.
 */
import { AnthropicProvider, type LLMProvider } from "@/lib/llm";
import { getCredentialForBrand, MissingCredentialError } from "./store";

export async function llmForBrand(brandId: string): Promise<LLMProvider> {
  const apiKey = await getCredentialForBrand(brandId, "anthropic");
  if (!apiKey) throw new MissingCredentialError("anthropic");
  return new AnthropicProvider({ apiKey });
}
