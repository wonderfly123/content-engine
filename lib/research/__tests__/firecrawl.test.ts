import { afterEach, describe, expect, it, vi } from 'vitest';
import { FirecrawlResearcher } from '../firecrawl';
import { ResearchError } from '../types';

const originalKey = process.env.FIRECRAWL_API_KEY;

afterEach(() => {
  process.env.FIRECRAWL_API_KEY = originalKey;
});

function makeResponse(body: unknown, ok = true, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  }) as unknown as Response;
}

describe('FirecrawlResearcher', () => {
  it('throws when FIRECRAWL_API_KEY is missing', () => {
    delete process.env.FIRECRAWL_API_KEY;
    expect(() => new FirecrawlResearcher()).toThrowError(ResearchError);
  });

  it('scrapeSite maps Firecrawl response to ScrapedSite', async () => {
    const httpClient = vi.fn().mockResolvedValue(
      makeResponse({
        success: true,
        data: {
          markdown: '# Hello',
          metadata: {
            title: 'Hello',
            description: 'desc',
            sourceURL: 'https://x.test',
          },
          links: ['https://x.test/a'],
        },
      }),
    );
    const r = new FirecrawlResearcher({ apiKey: 'k', httpClient });
    const out = await r.scrapeSite('https://x.test');
    expect(out.title).toBe('Hello');
    expect(out.url).toBe('https://x.test');
    expect(out.markdown).toBe('# Hello');
    expect(out.links).toEqual(['https://x.test/a']);
    expect(out.scraped_at).toBeTruthy();
    expect(httpClient).toHaveBeenCalledTimes(1);
    const [, init] = httpClient.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(init.headers.authorization).toBe('Bearer k');
  });

  it('searchKeyword maps results array', async () => {
    const httpClient = vi.fn().mockResolvedValue(
      makeResponse({
        success: true,
        data: [
          { title: 'A', url: 'https://a.test', description: 'd' },
          { title: 'B', url: 'https://b.test' },
        ],
      }),
    );
    const r = new FirecrawlResearcher({ apiKey: 'k', httpClient });
    const results = await r.searchKeyword('grip strength');
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ title: 'A', url: 'https://a.test', position: 1 });
    expect(results[1]).toMatchObject({ title: 'B', position: 2 });
  });

  it('throws ResearchError on non-2xx responses', async () => {
    const httpClient = vi
      .fn()
      .mockResolvedValue(makeResponse({ error: 'bad' }, false, 500));
    const r = new FirecrawlResearcher({ apiKey: 'k', httpClient });
    await expect(r.scrapeSite('https://x.test')).rejects.toThrow(ResearchError);
  });
});
