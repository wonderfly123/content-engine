/**
 * Builds the AI and research clients for one brand, using the keys of the workspace that owns it.
 * This is the only place those clients get a key; there is no shared environment key to fall back on.
 */
import { AnthropicProvider, type LLMProvider } from "@/lib/llm";
import { ApifyCompetitorScraper, FirecrawlResearcher, type CompetitorScraper, type Researcher } from "@/lib/research";
import { getCredentialForBrand, MissingCredentialError } from "./store";

export async function llmForBrand(brandId: string): Promise<LLMProvider> {
  const apiKey = await getCredentialForBrand(brandId, "anthropic");
  if (!apiKey) throw new MissingCredentialError("anthropic");
  return new AnthropicProvider({ apiKey });
}

export async function researcherForBrand(brandId: string): Promise<Researcher> {
  const apiKey = await getCredentialForBrand(brandId, "firecrawl");
  if (!apiKey) throw new MissingCredentialError("firecrawl");
  return new FirecrawlResearcher({ apiKey });
}

/** Apify is optional: without a token the scraper reports itself unavailable, as it always has. */
export async function competitorScraperForBrand(brandId: string): Promise<CompetitorScraper> {
  const token = await getCredentialForBrand(brandId, "apify");
  return new ApifyCompetitorScraper({ token: token ?? undefined });
}
