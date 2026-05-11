/**
 * Apify CompetitorScraper — Instagram post scraper.
 *
 * Section 11 rule: "Long-running scrapes (Apify): cron *enqueues* an Apify
 * run, polls completion in next cycle. Never block in cron."
 *
 * Task 4 surface area:
 *   - `startRun(handle, sinceDays)` — POST run-sync-get-dataset-items (short)
 *     OR POST runs (async). Public helpers below expose both.
 *   - `pollRun(runId)` — GET run status until SUCCEEDED / FAILED / TIMED-OUT.
 *   - `fetchRecentPosts(handle, sinceDays)` — high-level method. If
 *     `APIFY_TOKEN` is unset, returns mock data so dev environments work
 *     without credentials. If set, starts a real run and polls in-process up
 *     to 30s. Beyond 30s the caller should switch to the async-via-jobs flow
 *     (Task 6, jobs table).
 *
 * Default actor: `apify/instagram-scraper`. Override via constructor.
 */

import { z } from 'zod';
import {
  ResearchError,
  type CompetitorPost,
  type CompetitorScraper,
} from './types';

export type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface ApifyOptions {
  token?: string;
  actorId?: string;
  baseUrl?: string;
  httpClient?: FetchLike;
  /** Inline poll budget in ms. Beyond this, callers must switch to jobs table. */
  maxInlinePollMs?: number;
  pollIntervalMs?: number;
}

const runStartSchema = z.object({
  data: z.object({
    id: z.string(),
    actId: z.string().optional(),
    status: z.string(),
    defaultDatasetId: z.string().optional(),
  }),
});

const runStatusSchema = z.object({
  data: z.object({
    id: z.string(),
    status: z.string(),
    defaultDatasetId: z.string().optional(),
  }),
});

const igPostSchema = z
  .object({
    id: z.string().optional(),
    shortCode: z.string().optional(),
    url: z.string().optional(),
    caption: z.string().optional(),
    timestamp: z.string().optional(),
    likesCount: z.number().optional(),
    commentsCount: z.number().optional(),
    videoViewCount: z.number().optional(),
    type: z.string().optional(),
    hashtags: z.array(z.string()).optional(),
    ownerUsername: z.string().optional(),
  })
  .passthrough();

const datasetItemsSchema = z.array(igPostSchema);

const TERMINAL_OK = new Set(['SUCCEEDED']);
const TERMINAL_FAIL = new Set(['FAILED', 'TIMED-OUT', 'TIMEOUT', 'ABORTED']);

export class ApifyCompetitorScraper implements CompetitorScraper {
  private readonly token: string | undefined;
  private readonly actorId: string;
  private readonly baseUrl: string;
  private readonly http: FetchLike;
  private readonly maxInlinePollMs: number;
  private readonly pollIntervalMs: number;

  constructor(opts: ApifyOptions = {}) {
    this.token = opts.token ?? process.env.APIFY_TOKEN;
    // Slashes in actor ids must be URL-encoded as `~` per Apify convention.
    this.actorId = (opts.actorId ?? 'apify/instagram-scraper').replace('/', '~');
    this.baseUrl = opts.baseUrl ?? 'https://api.apify.com/v2';
    this.http = opts.httpClient ?? ((globalThis.fetch as unknown) as FetchLike);
    this.maxInlinePollMs = opts.maxInlinePollMs ?? 30_000;
    this.pollIntervalMs = opts.pollIntervalMs ?? 2_000;
  }

  /** Start an actor run, return the run id + dataset id. */
  async startRun(
    handle: string,
    sinceDays: number,
  ): Promise<{ runId: string; datasetId?: string }> {
    if (!this.token) {
      throw new ResearchError(
        'APIFY_TOKEN is not set — cannot start an actor run.',
        'missing_api_key',
      );
    }
    const input = {
      directUrls: [`https://www.instagram.com/${handle.replace(/^@/, '')}/`],
      resultsType: 'posts',
      resultsLimit: 30,
      addParentData: false,
      onlyPostsNewerThan: `${sinceDays} days`,
    };
    const url = `${this.baseUrl}/acts/${this.actorId}/runs?token=${encodeURIComponent(
      this.token,
    )}`;
    const res = await this.http(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new ResearchError(
        `Apify run-start returned ${res.status}: ${text}`,
        'api_error',
      );
    }
    const json = await res.json();
    const parsed = runStartSchema.safeParse(json);
    if (!parsed.success) {
      throw new ResearchError(
        `Apify run-start response did not match schema: ${parsed.error.message}`,
        'parse_error',
        parsed.error,
      );
    }
    return {
      runId: parsed.data.data.id,
      datasetId: parsed.data.data.defaultDatasetId,
    };
  }

  /** Single-shot run status check. */
  async getRunStatus(
    runId: string,
  ): Promise<{ status: string; datasetId?: string; terminal: boolean; ok: boolean }> {
    if (!this.token) {
      throw new ResearchError('APIFY_TOKEN is not set.', 'missing_api_key');
    }
    const url = `${this.baseUrl}/actor-runs/${runId}?token=${encodeURIComponent(
      this.token,
    )}`;
    const res = await this.http(url);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new ResearchError(
        `Apify run-status returned ${res.status}: ${text}`,
        'api_error',
      );
    }
    const json = await res.json();
    const parsed = runStatusSchema.safeParse(json);
    if (!parsed.success) {
      throw new ResearchError(
        `Apify run-status response did not match schema: ${parsed.error.message}`,
        'parse_error',
        parsed.error,
      );
    }
    const status = parsed.data.data.status;
    return {
      status,
      datasetId: parsed.data.data.defaultDatasetId,
      terminal: TERMINAL_OK.has(status) || TERMINAL_FAIL.has(status),
      ok: TERMINAL_OK.has(status),
    };
  }

  /**
   * Inline polling helper. Returns the final dataset id when terminal-ok, or
   * `null` if the budget expires before terminal. Callers exceeding the
   * budget must persist the run id and resume in the next cron cycle (Task 6
   * jobs table).
   */
  async pollRun(runId: string): Promise<string | null> {
    const start = Date.now();
    while (Date.now() - start < this.maxInlinePollMs) {
      const status = await this.getRunStatus(runId);
      if (status.terminal) {
        if (!status.ok) {
          throw new ResearchError(
            `Apify run ${runId} terminated with status=${status.status}`,
            'api_error',
          );
        }
        return status.datasetId ?? null;
      }
      await new Promise((r) => setTimeout(r, this.pollIntervalMs));
    }
    return null;
  }

  async getDatasetItems(datasetId: string): Promise<CompetitorPost[]> {
    if (!this.token) {
      throw new ResearchError('APIFY_TOKEN is not set.', 'missing_api_key');
    }
    const url = `${this.baseUrl}/datasets/${datasetId}/items?token=${encodeURIComponent(
      this.token,
    )}&clean=true&format=json`;
    const res = await this.http(url);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new ResearchError(
        `Apify dataset-items returned ${res.status}: ${text}`,
        'api_error',
      );
    }
    const json = await res.json();
    const parsed = datasetItemsSchema.safeParse(json);
    if (!parsed.success) {
      throw new ResearchError(
        `Apify dataset-items response did not match schema: ${parsed.error.message}`,
        'parse_error',
        parsed.error,
      );
    }
    return parsed.data.map((p) => mapIgPost(p));
  }

  /**
   * Task 4 high-level method. Behavior:
   *   - No `APIFY_TOKEN` set → returns deterministic mock data so the dev
   *     loop works without credentials.
   *   - Token set → starts a real run, polls inline up to `maxInlinePollMs`.
   *     If the run hasn't terminated within the budget, throws so the caller
   *     migrates to the jobs-table async flow (Task 6).
   */
  async fetchRecentPosts(
    handle: string,
    sinceDays: number,
  ): Promise<CompetitorPost[]> {
    if (!this.token) {
      return mockCompetitorPosts(handle, sinceDays);
    }
    const { runId } = await this.startRun(handle, sinceDays);
    const datasetId = await this.pollRun(runId);
    if (!datasetId) {
      throw new ResearchError(
        `Apify run ${runId} did not finish within inline poll budget (${this.maxInlinePollMs}ms). Switch to the jobs-table async flow (Task 6).`,
        'timeout',
      );
    }
    return this.getDatasetItems(datasetId);
  }
}

function mapIgPost(
  p: z.infer<typeof igPostSchema>,
): CompetitorPost {
  const code = p.shortCode ?? p.id ?? '';
  return {
    external_id: p.id ?? code,
    handle: p.ownerUsername ?? '',
    url: p.url ?? (code ? `https://www.instagram.com/p/${code}/` : ''),
    caption: p.caption,
    posted_at: p.timestamp,
    likes: p.likesCount,
    comments: p.commentsCount,
    views: p.videoViewCount,
    media_type:
      p.type === 'Video'
        ? 'video'
        : p.type === 'Sidecar'
          ? 'carousel'
          : p.type === 'Image'
            ? 'image'
            : 'unknown',
    hashtags: p.hashtags,
    raw: p,
  };
}

/** Deterministic mock so the brief pipeline runs locally without an APIFY_TOKEN. */
export function mockCompetitorPosts(
  handle: string,
  sinceDays: number,
): CompetitorPost[] {
  const cleaned = handle.replace(/^@/, '');
  const now = Date.now();
  return Array.from({ length: 3 }, (_, i) => ({
    external_id: `mock_${cleaned}_${i}`,
    handle: cleaned,
    url: `https://www.instagram.com/p/MOCK${i}/`,
    caption: `[mock] ${cleaned} post ${i} (since ${sinceDays}d)`,
    posted_at: new Date(now - i * 86_400_000).toISOString(),
    likes: 100 + i * 25,
    comments: 5 + i,
    views: 1000 + i * 200,
    media_type: i === 0 ? 'video' : i === 1 ? 'carousel' : 'image',
    hashtags: ['#mock'],
    raw: { mock: true },
  }));
}
