/**
 * Publisher adapter types. Section 3 + Pipeline 5a/5b of foundation spec.
 *
 * Locally typed `Post`, `Asset`, `ChannelConnection`, `AnalyticsSnapshot`
 * until Task 2 (DB schemas) lands.
 */

export type Channel =
  | 'instagram'
  | 'facebook'
  | 'blog'
  | 'newsletter'
  | 'linkedin'
  | 'tiktok'
  | 'pinterest';

export type Format =
  | 'reel'
  | 'carousel'
  | 'image'
  | 'story'
  | 'post'
  | 'article'
  | 'email'
  | 'pin';

export interface ChannelConnection {
  id?: string;
  brand_id: string;
  channel: Channel;
  external_account_id: string;
  access_token: string;
  refresh_token?: string | null;
  token_expires_at?: string | null;
  status: 'connected' | 'expired' | 'revoked' | 'error';
  meta_json?: Record<string, unknown>;
}

export interface Asset {
  id?: string;
  brand_id: string;
  kind: 'video' | 'image' | 'audio' | 'graphic';
  storage_url: string;
  thumbnail_url?: string | null;
  mime_type?: string;
  width?: number;
  height?: number;
  duration_sec?: number;
  size_bytes?: number;
  slot_index?: number;
  role?: 'primary' | 'cover' | 'b_roll';
}

export interface Post {
  id?: string;
  brand_id: string;
  channel: Channel;
  format: Format;
  caption: string;
  scheduled_for?: string;
  external_container_id?: string | null;
}

export interface AnalyticsSnapshot {
  external_post_id: string;
  pulled_at: string;
  reach?: number;
  impressions?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  watch_time_sec?: number;
  video_views?: number;
  profile_visits?: number;
  follows_from_post?: number;
  raw_json: unknown;
}

export interface PublishResult {
  externalId: string;
  url: string;
  /** Set when the publish is async (e.g. an IG container still processing). */
  pending?: boolean;
  containerId?: string;
}

export interface Publisher {
  connect(brandId: string): Promise<ChannelConnection>;
  publish(post: Post, assets: Asset[]): Promise<PublishResult>;
  fetchAnalytics(externalId: string): Promise<AnalyticsSnapshot>;
  refreshToken(connection: ChannelConnection): Promise<ChannelConnection>;
}

export class PublisherError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'not_implemented'
      | 'missing_config'
      | 'token_expired'
      | 'api_error'
      | 'unsupported_channel'
      | 'unknown',
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'PublisherError';
  }
}
