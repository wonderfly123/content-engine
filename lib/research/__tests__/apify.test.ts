import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApifyCompetitorScraper, mockCompetitorPosts } from '../apify';

const originalToken = process.env.APIFY_TOKEN;

afterEach(() => {
  if (originalToken === undefined) delete process.env.APIFY_TOKEN;
  else process.env.APIFY_TOKEN = originalToken;
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  }) as unknown as Response;
}

describe('ApifyCompetitorScraper', () => {
  it('returns mock data when APIFY_TOKEN is unset', async () => {
    delete process.env.APIFY_TOKEN;
    const scraper = new ApifyCompetitorScraper();
    const posts = await scraper.fetchRecentPosts('@wonderfly', 30);
    expect(posts).toHaveLength(3);
    expect(posts[0].handle).toBe('wonderfly');
    expect(posts[0].external_id.startsWith('mock_')).toBe(true);
  });

  it('mockCompetitorPosts is deterministic on handle', () => {
    const a = mockCompetitorPosts('foo', 30);
    const b = mockCompetitorPosts('foo', 30);
    expect(a.map((p) => p.external_id)).toEqual(b.map((p) => p.external_id));
  });

  it('startRun + pollRun + getDatasetItems flow with injected http', async () => {
    const calls: string[] = [];
    const httpClient = vi.fn(async (url: string | URL) => {
      const u = url.toString();
      calls.push(u);
      if (u.includes('/runs?token=')) {
        return jsonResponse({
          data: { id: 'run-1', status: 'RUNNING', defaultDatasetId: 'ds-1' },
        });
      }
      if (u.includes('/actor-runs/run-1')) {
        return jsonResponse({
          data: { id: 'run-1', status: 'SUCCEEDED', defaultDatasetId: 'ds-1' },
        });
      }
      if (u.includes('/datasets/ds-1/items')) {
        return jsonResponse([
          {
            id: 'abc',
            shortCode: 'abc',
            url: 'https://www.instagram.com/p/abc/',
            caption: 'hi',
            timestamp: '2026-05-01T00:00:00Z',
            likesCount: 10,
            commentsCount: 2,
            type: 'Video',
            ownerUsername: 'wonderfly',
          },
        ]);
      }
      return jsonResponse({ error: 'unexpected' }, 500);
    });

    const scraper = new ApifyCompetitorScraper({
      token: 't',
      httpClient,
      pollIntervalMs: 1,
      maxInlinePollMs: 1000,
    });
    const posts = await scraper.fetchRecentPosts('wonderfly', 30);
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({
      external_id: 'abc',
      handle: 'wonderfly',
      media_type: 'video',
      likes: 10,
    });
    // Verify the run -> status -> dataset URL sequence
    expect(calls[0]).toContain('/acts/apify~instagram-scraper/runs');
    expect(calls.some((u) => u.includes('/actor-runs/run-1'))).toBe(true);
    expect(calls.some((u) => u.includes('/datasets/ds-1/items'))).toBe(true);
  });
});
