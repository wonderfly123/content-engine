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
import {
  MetaGraphError,
  fetchFacebookPostInsights,
  fetchInstagramPostInsights,
  refreshLongLivedToken,
} from './meta-graph';

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
  /** Looks up the brand's channel connection. Defaults to the database; inject in tests. */
  loadConnection?: ConnectionLoader;
}

export type ConnectionLoader = (
  brandId: string,
  channel: 'instagram' | 'facebook',
) => Promise<ChannelConnection | null>;

const loadConnectionFromDb: ConnectionLoader = async (brandId, channel) => {
  const { db, schema } = await import('@/lib/db');
  const { and, eq } = await import('drizzle-orm');
  const rows = await db
    .select()
    .from(schema.channelConnections)
    .where(
      and(
        eq(schema.channelConnections.brandId, brandId),
        eq(schema.channelConnections.channel, channel),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    brand_id: row.brandId,
    channel: row.channel,
    external_account_id: row.externalAccountId ?? '',
    access_token: row.accessToken,
    refresh_token: row.refreshToken,
    token_expires_at: row.tokenExpiresAt ? row.tokenExpiresAt.toISOString() : null,
    status: row.status,
    meta_json: row.metaJson,
  };
};

export class MetaPublisher implements Publisher {
  readonly channel: 'instagram' | 'facebook';
  private readonly appId: string;
  private readonly appSecret: string;
  private readonly redirectUri: string;
  private readonly http: FetchLike;
  private readonly graphVersion: string;
  private readonly loadConnection: ConnectionLoader;

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
    // v27.0: trial Reels (`trial_params`) need a recent Graph version.
    this.graphVersion = opts.graphVersion ?? 'v27.0';
    this.loadConnection = opts.loadConnection ?? loadConnectionFromDb;
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
  /**
   * Instagram Reel: creates an UNPUBLISHED media container that Instagram fills
   * by fetching the video from its public `storage_url`, and returns
   * `{ pending: true, containerId }`. The cron pipeline then polls the container
   * and calls `media_publish` once it reports FINISHED.
   *
   * Hosted-URL route on purpose: direct (resumable) upload was rejected by
   * Instagram for videos of about 45 s or longer during testing (Nov 2026).
   */
  async publish(post: Post, assets: Asset[]): Promise<PublishResult> {
    if (this.channel !== 'instagram' || post.format !== 'reel') {
      throw new PublisherError(
        `MetaPublisher.publish only supports Instagram Reels so far (got ${this.channel}/${post.format}).`,
        'not_implemented',
      );
    }
    const video =
      assets.find((a) => a.kind === 'video' && (a.role ?? 'primary') === 'primary') ??
      assets.find((a) => a.kind === 'video');
    if (!video || !/^https:\/\//.test(video.storage_url)) {
      throw new PublisherError(
        'Reel publish needs a video asset with a public https storage_url.',
        'missing_config',
      );
    }
    const conn = await this.loadConnection(post.brand_id, 'instagram');
    if (!conn || !conn.access_token) {
      throw new PublisherError(
        `No connected Instagram account for brand ${post.brand_id}.`,
        'missing_config',
      );
    }
    const igUserId =
      (conn.meta_json?.igBusinessId as string | undefined) ??
      conn.external_account_id;
    if (!igUserId) {
      throw new PublisherError(
        'Instagram connection has no account id.',
        'missing_config',
      );
    }

    const body = new URLSearchParams({
      media_type: 'REELS',
      video_url: video.storage_url,
      caption: post.caption,
      access_token: conn.access_token,
    });
    const cover = assets.find((a) => a.role === 'cover' && a.kind !== 'video');
    if (cover) body.set('cover_url', cover.storage_url);
    if (post.trial) {
      body.set(
        'trial_params',
        JSON.stringify({
          graduation_strategy: post.trial === 'auto' ? 'SS_PERFORMANCE' : 'MANUAL',
        }),
      );
    }

    const res = await this.http(this.graphUrl(`${igUserId}/media`), {
      method: 'POST',
      body,
    });
    const json = (await res.json().catch(() => ({}))) as {
      id?: string;
      error?: { message?: string; code?: number; type?: string };
    };
    if (!res.ok || !json.id) {
      const message = json.error?.message ?? `Graph API ${res.status}`;
      const expired = json.error?.code === 190 || json.error?.type === 'OAuthException';
      throw new PublisherError(
        `Instagram container creation failed: ${message}`,
        expired ? 'token_expired' : 'api_error',
      );
    }
    return { externalId: '', url: '', pending: true, containerId: json.id };
  }

  async fetchAnalytics(
    externalId: string,
    connection: ChannelConnection,
  ): Promise<AnalyticsSnapshot> {
    if (!connection.access_token) {
      throw new PublisherError(
        'fetchAnalytics requires a connection with access_token',
        'missing_config',
      );
    }
    try {
      if (this.channel === 'instagram') {
        return await fetchInstagramPostInsights({
          externalPostId: externalId,
          accessToken: connection.access_token,
        });
      }
      return await fetchFacebookPostInsights({
        externalPostId: externalId,
        accessToken: connection.access_token,
      });
    } catch (err) {
      if (err instanceof MetaGraphError) {
        if (err.code === 'oauth_exception') {
          throw new PublisherError(err.message, 'token_expired', err);
        }
        throw new PublisherError(err.message, 'api_error', err);
      }
      throw err;
    }
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
  async refreshToken(
    connection: ChannelConnection,
  ): Promise<ChannelConnection> {
    if (!connection.access_token) {
      throw new PublisherError(
        'refreshToken requires a connection with access_token',
        'missing_config',
      );
    }
    try {
      const refreshed = await refreshLongLivedToken({
        appId: this.appId,
        appSecret: this.appSecret,
        currentAccessToken: connection.access_token,
      });
      return {
        ...connection,
        access_token: refreshed.accessToken,
        token_expires_at: refreshed.expiresAt
          ? refreshed.expiresAt.toISOString()
          : null,
        status: 'connected',
      };
    } catch (err) {
      if (err instanceof MetaGraphError && err.code === 'oauth_exception') {
        return { ...connection, status: 'expired' };
      }
      if (err instanceof MetaGraphError) {
        throw new PublisherError(err.message, 'api_error', err);
      }
      throw err;
    }
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
