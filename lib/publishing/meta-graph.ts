/**
 * Focused Meta Graph + Marketing API helpers.
 *
 * The Publisher adapter interface (`lib/publishing/meta.ts`) is intentionally
 * kept narrow. Anything that needs a per-brand access token (organic insights,
 * paid insights, token refresh, ad-account discovery) goes through THESE
 * helpers, called from the pipelines with the relevant `channel_connections`
 * row in hand. Mirrors the pattern already established for publish container
 * polling in `lib/pipelines/publish.ts`.
 */

import type { AnalyticsSnapshot } from "./types";

const GRAPH_VERSION = "v21.0";
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

export class MetaGraphError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "oauth_exception"
      | "rate_limit"
      | "http_error"
      | "parse_error",
    public readonly status?: number,
    public readonly raw?: unknown,
  ) {
    super(message);
    this.name = "MetaGraphError";
  }
}

interface FbApiError {
  error?: { type?: string; code?: number; message?: string; fbtrace_id?: string };
}

async function graphCall<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new MetaGraphError(
      `Failed to parse Graph response (HTTP ${res.status})`,
      "parse_error",
      res.status,
      text.slice(0, 500),
    );
  }
  if (!res.ok) {
    const err = (parsed as FbApiError).error;
    const type = err?.type ?? "";
    if (type === "OAuthException" || res.status === 401) {
      throw new MetaGraphError(
        err?.message ?? `OAuthException (HTTP ${res.status})`,
        "oauth_exception",
        res.status,
        parsed,
      );
    }
    if (res.status === 429) {
      throw new MetaGraphError(
        err?.message ?? "Rate limited",
        "rate_limit",
        res.status,
        parsed,
      );
    }
    throw new MetaGraphError(
      err?.message ?? `Graph HTTP ${res.status}`,
      "http_error",
      res.status,
      parsed,
    );
  }
  return parsed as T;
}

function withParams(
  path: string,
  params: Record<string, string | number | undefined>,
): string {
  const url = new URL(`${GRAPH}/${path.replace(/^\//, "")}`);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    url.searchParams.set(k, String(v));
  }
  return url.toString();
}

// ---------------------------------------------------------------------------
// Token refresh
// ---------------------------------------------------------------------------

export interface RefreshedToken {
  accessToken: string;
  expiresAt: Date | null;
}

/**
 * Exchange a long-lived token for a refreshed one. Long-lived tokens are
 * ~60 days; refresh proactively when `tokenExpiresAt` is within 7 days.
 * Throws MetaGraphError(code="oauth_exception") if the source token is
 * revoked/expired — callers should mark the connection `status='expired'`.
 */
export async function refreshLongLivedToken(args: {
  appId: string;
  appSecret: string;
  currentAccessToken: string;
}): Promise<RefreshedToken> {
  const url = withParams("/oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: args.appId,
    client_secret: args.appSecret,
    fb_exchange_token: args.currentAccessToken,
  });
  const body = await graphCall<{
    access_token: string;
    token_type?: string;
    expires_in?: number;
  }>(url);
  return {
    accessToken: body.access_token,
    expiresAt: body.expires_in
      ? new Date(Date.now() + body.expires_in * 1000)
      : null,
  };
}

// ---------------------------------------------------------------------------
// Organic post insights
// ---------------------------------------------------------------------------

// Updated for IG metric deprecation (Apr 2025): `impressions`, `engagement`,
// `video_views`, `plays` were removed. `views` is now the single delivery
// metric across all media types. `saved` is singular (not `saves`).
// This set works across IMAGE / VIDEO / CAROUSEL / REELS. Reels-specific
// retention metrics (ig_reels_avg_watch_time, ig_reels_video_view_total_time)
// are fetched separately when needed.
const IG_POST_METRICS = [
  "views",
  "reach",
  "likes",
  "comments",
  "shares",
  "saved",
  "total_interactions",
];

// Updated for FB Page Insights deprecation (Nov 15, 2025): `post_impressions`,
// `post_impressions_unique`, `post_impressions_paid`, `post_impressions_organic`
// were removed. Use `post_views` instead — no unique-views equivalent at the
// post level.
const FB_POST_METRICS = [
  "post_views",
  "post_clicks",
  "post_engaged_users",
  "post_reactions_by_type_total",
];

interface InsightsResponse {
  data: Array<{
    name: string;
    period?: string;
    values: Array<{ value: number | Record<string, number>; end_time?: string }>;
  }>;
}

/**
 * Pull organic insights for an Instagram media id.
 * IG only exposes insights for Business/Creator accounts; the access token
 * must be the Page token linked to the IG Business account.
 */
export async function fetchInstagramPostInsights(args: {
  externalPostId: string;
  accessToken: string;
}): Promise<AnalyticsSnapshot> {
  const insightsUrl = withParams(`/${args.externalPostId}/insights`, {
    metric: IG_POST_METRICS.join(","),
    access_token: args.accessToken,
  });
  const insights = await graphCall<InsightsResponse>(insightsUrl);

  // Tolerate per-metric failures (e.g. video_views on non-video media):
  // Meta returns a partial array; missing metrics become 0.
  const m = new Map<string, number>();
  for (const row of insights.data ?? []) {
    const v = row.values?.[0]?.value;
    if (typeof v === "number") m.set(row.name, v);
  }

  // NOTE: 2026 mapping — IG `views` replaces the deprecated `impressions`
  // and `video_views`. We store it in `impressions` for backward compat with
  // existing AnalyticsSnapshot consumers (analytics aggregation, UI cards).
  // `saved` (singular) maps to our internal `saves`.
  return {
    external_post_id: args.externalPostId,
    pulled_at: new Date().toISOString(),
    reach: m.get("reach"),
    impressions: m.get("views"),
    likes: m.get("likes"),
    comments: m.get("comments"),
    shares: m.get("shares"),
    saves: m.get("saved"),
    video_views: m.get("views"),
    raw_json: insights as unknown,
  };
}

/**
 * Pull organic insights for a Facebook post (`{page_id}_{post_id}` form).
 * Uses the page-scoped access token.
 *
 * Post-Nov-15-2025: `post_impressions*` removed. We use `post_views` as the
 * single delivery metric and map it to our internal `impressions` field for
 * backward compat. There is no unique-views replacement at the post level —
 * `reach` will be undefined.
 */
export async function fetchFacebookPostInsights(args: {
  externalPostId: string;
  accessToken: string;
}): Promise<AnalyticsSnapshot> {
  const insightsUrl = withParams(`/${args.externalPostId}/insights`, {
    metric: FB_POST_METRICS.join(","),
    access_token: args.accessToken,
  });
  const insights = await graphCall<InsightsResponse>(insightsUrl);

  // Side call for like/comment/share totals on the post object.
  const postObjUrl = withParams(`/${args.externalPostId}`, {
    fields:
      "likes.summary(true).limit(0),comments.summary(true).limit(0),shares,permalink_url",
    access_token: args.accessToken,
  });
  const postObj = await graphCall<{
    likes?: { summary?: { total_count?: number } };
    comments?: { summary?: { total_count?: number } };
    shares?: { count?: number };
  }>(postObjUrl);

  const m = new Map<string, number>();
  for (const row of insights.data ?? []) {
    const v = row.values?.[0]?.value;
    if (typeof v === "number") m.set(row.name, v);
  }

  return {
    external_post_id: args.externalPostId,
    pulled_at: new Date().toISOString(),
    reach: undefined, // no unique-views replacement at post level post-2025
    impressions: m.get("post_views"),
    likes: postObj.likes?.summary?.total_count,
    comments: postObj.comments?.summary?.total_count,
    shares: postObj.shares?.count,
    raw_json: { insights, postObj } as unknown,
  };
}

/** Account-level counts for the follower-growth time series. */
export interface AccountMetrics {
  followerCount: number | null;
  followingCount: number | null;
  totalPosts: number | null;
  raw: unknown;
}

/**
 * Instagram: followers, following and media count of the professional account.
 * Facebook: Page followers (no following / post count at the Page level).
 */
export async function fetchAccountMetrics(args: {
  channel: "instagram" | "facebook";
  accountId: string;
  accessToken: string;
}): Promise<AccountMetrics> {
  const num = (v: unknown) => (typeof v === "number" ? v : null);
  if (args.channel === "instagram") {
    const raw = await graphCall<Record<string, unknown>>(
      withParams(`/${args.accountId}`, {
        fields: "followers_count,follows_count,media_count",
        access_token: args.accessToken,
      }),
    );
    return {
      followerCount: num(raw.followers_count),
      followingCount: num(raw.follows_count),
      totalPosts: num(raw.media_count),
      raw,
    };
  }
  const raw = await graphCall<Record<string, unknown>>(
    withParams(`/${args.accountId}`, {
      fields: "followers_count,fan_count",
      access_token: args.accessToken,
    }),
  );
  return {
    followerCount: num(raw.followers_count) ?? num(raw.fan_count),
    followingCount: null,
    totalPosts: null,
    raw,
  };
}

// ---------------------------------------------------------------------------
// Ad accounts (discovery)
// ---------------------------------------------------------------------------

export interface MetaAdAccount {
  id: string; // "act_…"
  account_id: string;
  name: string;
  currency?: string;
  account_status?: number;
  business?: { id: string; name?: string };
}

export async function listAdAccounts(args: {
  userAccessToken: string;
}): Promise<MetaAdAccount[]> {
  const url = withParams("/me/adaccounts", {
    access_token: args.userAccessToken,
    fields: "id,account_id,name,currency,account_status,business",
    limit: 200,
  });
  const body = await graphCall<{ data: MetaAdAccount[] }>(url);
  return body.data ?? [];
}

// ---------------------------------------------------------------------------
// Marketing API — hierarchy + insights
// ---------------------------------------------------------------------------

// `daily_budget` and `lifetime_budget` are returned as MINOR-UNIT strings
// (cents for USD). Insights `spend` is in MAJOR units (dollars). The ingest
// pipeline normalizes budgets to major units so storage is consistent.
export interface MetaCampaign {
  id: string;
  name: string;
  objective?: string;
  status?: string;
  effective_status?: string;
  buying_type?: string;
  daily_budget?: string; // minor units (cents)
  lifetime_budget?: string; // minor units (cents)
  start_time?: string;
  stop_time?: string;
}

export interface MetaAdSet {
  id: string;
  campaign_id: string;
  name: string;
  status?: string;
  effective_status?: string;
  optimization_goal?: string;
  billing_event?: string;
  daily_budget?: string; // minor units (cents)
  lifetime_budget?: string; // minor units (cents)
  start_time?: string;
  end_time?: string;
}

export interface MetaAd {
  id: string;
  adset_id: string;
  campaign_id: string;
  name: string;
  status?: string;
  effective_status?: string;
  creative?: { id: string };
}

export interface MetaAdCreative {
  id: string;
  /**
   * For FB Page boosted posts: `{page_id}_{fb_post_id}` — matches
   * `posts.external_post_id` directly.
   *
   * For IG boosted posts: a Page-side dark-post id `{page_id}_{dark_post_id}`,
   * NOT the IG media id. Use `instagram_permalink_url` to back-match to the
   * IG post via its shortcode.
   */
  effective_object_story_id?: string;
  instagram_permalink_url?: string;
  thumbnail_url?: string;
  body?: string;
  image_url?: string;
}

export interface MetaAdInsightsRow {
  ad_id: string;
  adset_id: string;
  campaign_id: string;
  account_id: string;
  date_start: string;
  date_stop: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  frequency?: string;
  clicks?: string;
  unique_clicks?: string;
  inline_link_clicks?: string;
  outbound_clicks?: Array<{ action_type: string; value: string }>;
  ctr?: string;
  cpc?: string;
  cpm?: string;
  cpp?: string;
}

async function paginate<T>(initialUrl: string): Promise<T[]> {
  const all: T[] = [];
  let url: string | null = initialUrl;
  let safety = 0;
  while (url && safety < 50) {
    const body: { data: T[]; paging?: { next?: string } } = await graphCall<{
      data: T[];
      paging?: { next?: string };
    }>(url);
    if (Array.isArray(body.data)) all.push(...body.data);
    url = body.paging?.next ?? null;
    safety++;
  }
  return all;
}

export async function listCampaigns(args: {
  adAccountId: string;
  accessToken: string;
}): Promise<MetaCampaign[]> {
  const url = withParams(`/${args.adAccountId}/campaigns`, {
    access_token: args.accessToken,
    fields:
      "id,name,objective,status,effective_status,buying_type," +
      "daily_budget,lifetime_budget,start_time,stop_time",
    limit: 200,
  });
  return paginate<MetaCampaign>(url);
}

export async function listAdSets(args: {
  adAccountId: string;
  accessToken: string;
}): Promise<MetaAdSet[]> {
  const url = withParams(`/${args.adAccountId}/adsets`, {
    access_token: args.accessToken,
    fields:
      "id,campaign_id,name,status,effective_status,optimization_goal," +
      "billing_event,daily_budget,lifetime_budget,start_time,end_time",
    limit: 200,
  });
  return paginate<MetaAdSet>(url);
}

export async function listAds(args: {
  adAccountId: string;
  accessToken: string;
}): Promise<MetaAd[]> {
  const url = withParams(`/${args.adAccountId}/ads`, {
    access_token: args.accessToken,
    fields: "id,adset_id,campaign_id,name,status,effective_status,creative",
    limit: 200,
  });
  return paginate<MetaAd>(url);
}

export async function getAdCreative(args: {
  creativeId: string;
  accessToken: string;
}): Promise<MetaAdCreative | null> {
  const url = withParams(`/${args.creativeId}`, {
    access_token: args.accessToken,
    fields:
      "id,effective_object_story_id,instagram_permalink_url," +
      "thumbnail_url,body,image_url",
  });
  try {
    return await graphCall<MetaAdCreative>(url);
  } catch (err) {
    if (err instanceof MetaGraphError && err.code === "http_error") return null;
    throw err;
  }
}

/**
 * Pull daily ad-level insights from `/act_{id}/insights`.
 * `since` and `until` are YYYY-MM-DD (inclusive). Defaults to trailing 30d.
 */
export async function fetchAdInsightsDaily(args: {
  adAccountId: string;
  accessToken: string;
  since?: string;
  until?: string;
}): Promise<MetaAdInsightsRow[]> {
  const today = new Date();
  const ymd = (d: Date): string => d.toISOString().slice(0, 10);
  const since =
    args.since ?? ymd(new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000));
  const until = args.until ?? ymd(today);

  const url = withParams(`/${args.adAccountId}/insights`, {
    access_token: args.accessToken,
    level: "ad",
    time_increment: 1,
    time_range: JSON.stringify({ since, until }),
    fields:
      "ad_id,adset_id,campaign_id,account_id," +
      "spend,impressions,reach,frequency," +
      "clicks,unique_clicks,inline_link_clicks,outbound_clicks," +
      "ctr,cpc,cpm,cpp",
    limit: 500,
  });
  return paginate<MetaAdInsightsRow>(url);
}
