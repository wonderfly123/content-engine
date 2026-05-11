/**
 * Research adapter factory. Service-layer code imports from `@/lib/research`.
 */

import { ApifyCompetitorScraper } from './apify';
import { FirecrawlResearcher } from './firecrawl';
import type { CompetitorScraper, Researcher } from './types';

export * from './types';
export { FirecrawlResearcher } from './firecrawl';
export { ApifyCompetitorScraper, mockCompetitorPosts } from './apify';

let researcher: Researcher | undefined;
let competitor: CompetitorScraper | undefined;

export function getResearcher(): Researcher {
  if (!researcher) researcher = new FirecrawlResearcher();
  return researcher;
}

export function getCompetitorScraper(): CompetitorScraper {
  if (!competitor) competitor = new ApifyCompetitorScraper();
  return competitor;
}

/** Reset cached adapters — useful in tests. */
export function __resetResearchAdapters(): void {
  researcher = undefined;
  competitor = undefined;
}
