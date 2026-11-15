/**
 * Research adapters. Service-layer code imports from `@/lib/research`.
 * Adapters are built per workspace with that workspace's own keys: see
 * `researcherForBrand` and `competitorScraperForBrand` in `@/lib/credentials/clients`.
 */

export * from './types';
export { FirecrawlResearcher } from './firecrawl';
export { ApifyCompetitorScraper, mockCompetitorPosts } from './apify';
