/**
 * Research adapter types. Section 3 of foundation spec.
 */

export interface ScrapedSite {
  url: string;
  title?: string;
  description?: string;
  markdown: string;
  html?: string;
  links?: string[];
  scraped_at: string;
  raw?: unknown;
}

export interface SerpResult {
  title: string;
  url: string;
  description?: string;
  position?: number;
  featured_snippet?: boolean;
  raw?: unknown;
}

export interface Researcher {
  scrapeSite(url: string): Promise<ScrapedSite>;
  searchKeyword(keyword: string): Promise<SerpResult[]>;
}

export interface CompetitorPost {
  external_id: string;
  handle: string;
  url: string;
  caption?: string;
  posted_at?: string;
  likes?: number;
  comments?: number;
  shares?: number;
  views?: number;
  media_type?: 'image' | 'video' | 'carousel' | 'unknown';
  hashtags?: string[];
  raw?: unknown;
}

export interface CompetitorScraper {
  fetchRecentPosts(handle: string, sinceDays: number): Promise<CompetitorPost[]>;
}

export class ResearchError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'missing_api_key'
      | 'api_error'
      | 'timeout'
      | 'parse_error'
      | 'unknown',
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ResearchError';
  }
}
