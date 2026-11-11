import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MetaPublisher } from '../meta';
import { PublisherError } from '../types';
import { getPublisher, __resetPublishers } from '../index';

const ENV_KEYS = ['META_APP_ID', 'META_APP_SECRET', 'META_REDIRECT_URI'] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  __resetPublishers();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  __resetPublishers();
});

describe('MetaPublisher', () => {
  it('throws when Meta env vars are missing', () => {
    for (const k of ENV_KEYS) delete process.env[k];
    expect(() => new MetaPublisher({ channel: 'instagram' })).toThrowError(
      PublisherError,
    );
  });

  it('constructs when env vars are present', () => {
    process.env.META_APP_ID = 'app';
    process.env.META_APP_SECRET = 'secret';
    process.env.META_REDIRECT_URI = 'https://example.com/cb';
    const pub = new MetaPublisher({ channel: 'instagram' });
    expect(pub.channel).toBe('instagram');
  });

  it('connect returns a stub ChannelConnection with status=error', async () => {
    const pub = new MetaPublisher({
      channel: 'facebook',
      appId: 'a',
      appSecret: 'b',
      redirectUri: 'c',
    });
    const conn = await pub.connect('brand-1');
    expect(conn.brand_id).toBe('brand-1');
    expect(conn.channel).toBe('facebook');
    expect(conn.status).toBe('error');
  });

  const reelPost = { brand_id: 'b', channel: 'instagram', format: 'reel', caption: 'hi' } as const;
  const videoAsset = {
    brand_id: 'b',
    kind: 'video',
    storage_url: 'https://media.example.com/reels/cut.mp4',
    role: 'primary',
  } as const;
  const connection = {
    brand_id: 'b',
    channel: 'instagram',
    external_account_id: 'ig-1',
    access_token: 'tok',
    status: 'connected',
    meta_json: { igBusinessId: 'ig-1' },
  } as const;

  function reelPublisher(http: (url: string, init?: RequestInit) => Promise<Response>) {
    return new MetaPublisher({
      channel: 'instagram',
      appId: 'a',
      appSecret: 'b',
      redirectUri: 'c',
      httpClient: (input, init) => http(String(input), init),
      loadConnection: async () => ({ ...connection }),
    });
  }

  it('publish creates an unpublished Reel container from the hosted video URL', async () => {
    const calls: Array<{ url: string; body: URLSearchParams }> = [];
    const pub = reelPublisher(async (url, init) => {
      calls.push({ url, body: init?.body as URLSearchParams });
      return new Response(JSON.stringify({ id: 'container-9' }), { status: 200 });
    });
    const result = await pub.publish({ ...reelPost, trial: 'manual' }, [{ ...videoAsset }]);

    expect(result).toEqual({ externalId: '', url: '', pending: true, containerId: 'container-9' });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toMatch(/\/ig-1\/media$/);
    expect(calls[0].body.get('media_type')).toBe('REELS');
    expect(calls[0].body.get('video_url')).toBe(videoAsset.storage_url);
    expect(calls[0].body.get('caption')).toBe('hi');
    expect(JSON.parse(calls[0].body.get('trial_params')!)).toEqual({ graduation_strategy: 'MANUAL' });
  });

  it('publish sends no trial_params for a normal Reel', async () => {
    let body: URLSearchParams | undefined;
    const pub = reelPublisher(async (_url, init) => {
      body = init?.body as URLSearchParams;
      return new Response(JSON.stringify({ id: 'c' }), { status: 200 });
    });
    await pub.publish({ ...reelPost }, [{ ...videoAsset }]);
    expect(body!.has('trial_params')).toBe(false);
  });

  it('publish maps Graph errors: expired token vs other API errors', async () => {
    const expired = reelPublisher(async () =>
      new Response(JSON.stringify({ error: { message: 'expired', code: 190, type: 'OAuthException' } }), { status: 400 }),
    );
    await expect(expired.publish({ ...reelPost }, [{ ...videoAsset }])).rejects.toMatchObject({ code: 'token_expired' });

    const other = reelPublisher(async () =>
      new Response(JSON.stringify({ error: { message: 'bad video', code: 100 } }), { status: 400 }),
    );
    await expect(other.publish({ ...reelPost }, [{ ...videoAsset }])).rejects.toMatchObject({ code: 'api_error' });
  });

  it('publish refuses a missing or non-public video, a missing connection, and unsupported formats', async () => {
    const never = async () => { throw new Error('must not call the network'); };
    const pub = reelPublisher(never);
    await expect(pub.publish({ ...reelPost }, [])).rejects.toMatchObject({ code: 'missing_config' });
    await expect(
      pub.publish({ ...reelPost }, [{ ...videoAsset, storage_url: '/Users/me/cut.mp4' }]),
    ).rejects.toMatchObject({ code: 'missing_config' });
    await expect(
      pub.publish({ ...reelPost, format: 'carousel' }, [{ ...videoAsset }]),
    ).rejects.toMatchObject({ code: 'not_implemented' });

    const noConn = new MetaPublisher({
      channel: 'instagram', appId: 'a', appSecret: 'b', redirectUri: 'c',
      httpClient: never, loadConnection: async () => null,
    });
    await expect(noConn.publish({ ...reelPost }, [{ ...videoAsset }])).rejects.toMatchObject({ code: 'missing_config' });
  });

  it('fetchAnalytics / refreshToken require an access_token on the connection', async () => {
    const pub = new MetaPublisher({
      channel: 'instagram',
      appId: 'a',
      appSecret: 'b',
      redirectUri: 'c',
    });
    await expect(
      pub.fetchAnalytics('x', {
        brand_id: 'b',
        channel: 'instagram',
        external_account_id: 'x',
        access_token: '',
        status: 'connected',
      }),
    ).rejects.toMatchObject({ code: 'missing_config' });
    await expect(
      pub.refreshToken({
        brand_id: 'b',
        channel: 'instagram',
        external_account_id: 'x',
        access_token: '',
        status: 'connected',
      }),
    ).rejects.toMatchObject({ code: 'missing_config' });
  });

  it('getPublisher throws on unsupported channels', () => {
    process.env.META_APP_ID = 'a';
    process.env.META_APP_SECRET = 'b';
    process.env.META_REDIRECT_URI = 'c';
    expect(() =>
      getPublisher('tiktok' as unknown as 'instagram'),
    ).toThrowError(PublisherError);
  });
});
