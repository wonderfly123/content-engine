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

  it('publish / fetchAnalytics / refreshToken throw not_implemented (Task 6)', async () => {
    const pub = new MetaPublisher({
      channel: 'instagram',
      appId: 'a',
      appSecret: 'b',
      redirectUri: 'c',
    });
    await expect(
      pub.publish(
        { brand_id: 'b', channel: 'instagram', format: 'reel', caption: 'hi' },
        [],
      ),
    ).rejects.toMatchObject({ code: 'not_implemented' });
    await expect(pub.fetchAnalytics('x')).rejects.toMatchObject({
      code: 'not_implemented',
    });
    await expect(
      pub.refreshToken({
        brand_id: 'b',
        channel: 'instagram',
        external_account_id: 'x',
        access_token: 't',
        status: 'connected',
      }),
    ).rejects.toMatchObject({ code: 'not_implemented' });
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
