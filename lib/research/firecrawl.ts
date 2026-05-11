/**
 * Firecrawl Researcher adapter.
 *
 * Endpoints (https://docs.firecrawl.dev):
 *   POST https://api.firecrawl.dev/v1/scrape  — single-page scrape
 *   POST https://api.firecrawl.dev/v1/search  — Google SERP (markdown results)
 *
 * Testability: constructor accepts an optional `httpClient` (fetch-shaped) so
 * tests can inject a stub without hitting the network.
 */

import { z } from 'zod';
import {
  ResearchError,
  type Researcher,
  type ScrapedSite,
  type SerpResult,
} from './types';

export type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface FirecrawlOptions {
  apiKey?: string;
  baseUrl?: string;
  httpClient?: FetchLike;
}

const scrapeResponseSchema = z.object({
  success: z.boolean().optional(),
  data: z
    .object({
      markdown: z.string().optional(),
      html: z.string().optional(),
      metadata: z
        .object({
          title: z.string().optional(),
          description: z.string().optional(),
          sourceURL: z.string().optional(),
          url: z.string().optional(),
        })
        .optional(),
      links: z.array(z.string()).optional(),
    })
    .optional(),
});

const searchResponseSchema = z.object({
  success: z.boolean().optional(),
  data: z
    .array(
      z.object({
        title: z.string().optional(),
        url: z.string().optional(),
        description: z.string().optional(),
        markdown: z.string().optional(),
        position: z.number().optional(),
      }),
    )
    .optional(),
});

export class FirecrawlResearcher implements Researcher {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly http: FetchLike;

  constructor(opts: FirecrawlOptions = {}) {
    const apiKey = opts.apiKey ?? process.env.FIRECRAWL_API_KEY;
    if (!apiKey) {
      throw new ResearchError(
        'FIRECRAWL_API_KEY is not set. Add it to your environment to use the Firecrawl researcher.',
        'missing_api_key',
      );
    }
    this.apiKey = apiKey;
    this.baseUrl = opts.baseUrl ?? 'https://api.firecrawl.dev';
    this.http = opts.httpClient ?? ((globalThis.fetch as unknown) as FetchLike);
  }

  private async post<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
    let res: Response;
    try {
      res = await this.http(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new ResearchError(
        `Firecrawl network error: ${(err as Error).message}`,
        'api_error',
        err,
      );
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new ResearchError(
        `Firecrawl ${path} returned ${res.status}: ${text}`,
        'api_error',
      );
    }
    let json: unknown;
    try {
      json = await res.json();
    } catch (err) {
      throw new ResearchError(
        `Firecrawl ${path} returned non-JSON response`,
        'parse_error',
        err,
      );
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new ResearchError(
        `Firecrawl ${path} response did not match schema: ${parsed.error.message}`,
        'parse_error',
        parsed.error,
      );
    }
    return parsed.data;
  }

  async scrapeSite(url: string): Promise<ScrapedSite> {
    const json = await this.post(
      '/v1/scrape',
      { url, formats: ['markdown', 'html', 'links'] },
      scrapeResponseSchema,
    );
    const data = json.data ?? {};
    return {
      url: data.metadata?.sourceURL ?? data.metadata?.url ?? url,
      title: data.metadata?.title,
      description: data.metadata?.description,
      markdown: data.markdown ?? '',
      html: data.html,
      links: data.links,
      scraped_at: new Date().toISOString(),
      raw: json,
    };
  }

  async searchKeyword(keyword: string): Promise<SerpResult[]> {
    const json = await this.post(
      '/v1/search',
      { query: keyword, limit: 5 },
      searchResponseSchema,
    );
    const results = json.data ?? [];
    return results.map((r, i) => ({
      title: r.title ?? '',
      url: r.url ?? '',
      description: r.description,
      position: r.position ?? i + 1,
      featured_snippet: false,
      raw: r,
    }));
  }
}
