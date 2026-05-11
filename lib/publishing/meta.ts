/**
 * Meta Graph API Publisher (Instagram Business/Creator + Facebook Pages).
 *
 * SCOPE NOTE — Task 4: This adapter defines the interface, validates env vars,
 * and stubs the network surface. Real publish/analytics/token-refresh land in
 * Task 6. JSDoc on each method documents the planned Graph endpoint sequence
 * per Section 6 Pipeline 5a of the foundation spec.
 *
 * Testability: constructor accepts an optional `httpClient` (fetch-shaped) so
 * tests can inject a stub once real calls land in Task 6.
 */

import {
  PublisherError,
  type Asset,
  type ChannelConnection,
  type AnalyticsSnapshot,
  type Post,
  type PublishResult,
  type Publisher,
} from './types';

export type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface MetaPublisherOptions {
  channel: 'instagram' | 'facebook';
  appId?: string;
  appSecret?: string;
  redirectUri?: string;
  httpClient?: FetchLike;
  /** Graph API version. Bump in one place when Meta deprecates. */
  graphVersion?: string;
}

export class MetaPublisher implements Publisher {
  readonly channel: 'instagram' | 'facebook';
  private readonly appId: string;
  private readonly appSecret: string;
  private readonly redirectUri: string;
  private readonly http: FetchLike;
  private readonly graphVersion: string;

  constructor(opts: MetaPublisherOptions) {
    this.channel = opts.channel;
    const appId = opts.appId ?? process.env.META_APP_ID;
    const appSecret = opts.appSecret ?? process.env.META_APP_SECRET;
    const redirectUri = opts.redirectUri ?? process.env.META_REDIRECT_URI;
    if (!appId || !appSecret || !redirectUri) {
      throw new PublisherError(
        'Meta Publisher requires META_APP_ID, META_APP_SECRET, and META_REDIRECT_URI to be set in the environment.',
        'missing_config',
      );
    }
    this.appId = appId;
    this.appSecret = appSecret;
    this.redirectUri = redirectUri;
    this.http = opts.httpClient ?? ((globalThis.fetch as unknown) as FetchLike);
    this.graphVersion = opts.graphVersion ?? 'v21.0';
  }

  /**
   * Task 4 stub. Real OAuth flow lands in Task 5 (onboarding step 7) and Task 6.
   *
   * Planned Graph endpoints:
   *   - GET https://www.facebook.com/{version}/dialog/oauth
   *       ?client_id={appId}&redirect_uri={redirectUri}
   *       &scope=instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement,pages_manage_posts
   *   - POST /oauth/access_token (exchange code → short-lived token)
   *   - GET  /oauth/access_token?grant_type=fb_exchange_token (→ long-lived ~60d)
   *   - GET  /me/accounts (list FB pages + IG accounts)
   *
   * Returns a stub ChannelConnection with status='error' so callers fail loud
   * if they accidentally use it before Task 6 lands.
   */
  async connect(brandId: string): Promise<ChannelConnection> {
    return {
      brand_id: brandId,
      channel: this.channel,
      external_account_id: '',
      access_token: '',
      refresh_token: null,
      token_expires_at: null,
      status: 'error',
      meta_json: {
        stub: true,
        note: 'OAuth flow lands in Task 5/6. Use this object as a typecheck only.',
      },
    };
  }

  /**
   * Task 4 stub. Real publish lands in Task 6.
   *
   * Planned Graph endpoint sequence per Pipeline 5a:
   *
   * IG Reel (format='reel', kind='video'):
   *   1. POST /{ig_user_id}/media
   *        ?media_type=REELS&video_url={assets[0].storage_url}
   *        &caption={post.caption}&share_to_feed=true
   *      → returns container id → store as posts.external_container_id
   *   2. POLL GET /{container_id}?fields=status_code until status_code='FINISHED'
   *      (NEVER block past cron window — re-poll next 5-min cycle if PROCESSING)
   *   3. POST /{ig_user_id}/media_publish?creation_id={container_id}
   *      → returns media_id → store as posts.external_post_id
   *
   * IG Carousel (format='carousel'):
   *   1. For each child asset: POST /{ig_user_id}/media
   *        ?is_carousel_item=true&image_url={asset.storage_url}
   *      → collect child container ids
   *   2. POST /{ig_user_id}/media
   *        ?media_type=CAROUSEL&caption={caption}&children={id1,id2,...}
   *   3. POST /{ig_user_id}/media_publish?creation_id={container_id}
   *
   * IG Image (format='image'):
   *   1. POST /{ig_user_id}/media?image_url={url}&caption={caption}
   *   2. POST /{ig_user_id}/media_publish?creation_id={container_id}
   *
   * FB Post (channel='facebook'):
   *   - text: POST /{page_id}/feed?message={caption}
   *   - photo: POST /{page_id}/photos?url={url}&caption={caption}
   *   - video: POST /{page_id}/videos?file_url={url}&description={caption}
   *
   * Returns `{ externalId, url }` on success. For long-running IG Reel
   * containers that haven't finished encoding, returns `{ pending: true,
   * containerId }` so the caller persists `external_container_id` and the
   * next cron cycle finalizes via `media_publish`.
   */
  async publish(_post: Post, _assets: Asset[]): Promise<PublishResult> {
    throw new PublisherError(
      'MetaPublisher.publish is not implemented yet — lands in Task 6.',
      'not_implemented',
    );
  }

  /**
   * Task 4 stub. Real implementation lands in Task 6 / Pipeline 5b.
   *
   * Planned Graph endpoint:
   *   GET /{external_post_id}/insights
   *     ?metric=reach,impressions,likes,comments,shares,saves,
   *             video_views,total_interactions,profile_visits,follows
   *   GET /{external_post_id}?fields=comments_count,like_count,permalink
   *
   * Every call inserts a NEW analytics_snapshots row (time series — never
   * update). Hourly for posts <7d, daily for posts 7-30d.
   */
  async fetchAnalytics(_externalId: string): Promise<AnalyticsSnapshot> {
    throw new PublisherError(
      'MetaPublisher.fetchAnalytics is not implemented yet — lands in Task 6.',
      'not_implemented',
    );
  }

  /**
   * Task 4 stub. Real implementation lands in Task 6.
   *
   * Planned Graph endpoint:
   *   GET /oauth/access_token
   *     ?grant_type=fb_exchange_token&client_id={appId}
   *     &client_secret={appSecret}&fb_exchange_token={current_access_token}
   *
   * Long-lived tokens are ~60d. Refresh proactively when token_expires_at is
   * within 7 days. On 401 / OAuthException, mark connection 'expired' and
   * surface in system_alerts (Pipeline 5a token-expiry handling).
   */
  async refreshToken(_connection: ChannelConnection): Promise<ChannelConnection> {
    throw new PublisherError(
      'MetaPublisher.refreshToken is not implemented yet — lands in Task 6.',
      'not_implemented',
    );
  }

  /** Exposed for Task 6 — base URL for all Graph calls. */
  protected graphUrl(path: string): string {
    return `https://graph.facebook.com/${this.graphVersion}/${path.replace(/^\//, '')}`;
  }

  /** Wired but unused in Task 4 — keeps the http injection point honest. */
  protected getHttp(): FetchLike {
    return this.http;
  }

  /** Wired but unused in Task 4 — exercised by Task 6. */
  protected getAppCreds(): { appId: string; appSecret: string; redirectUri: string } {
    return { appId: this.appId, appSecret: this.appSecret, redirectUri: this.redirectUri };
  }
}
