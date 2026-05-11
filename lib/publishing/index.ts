/**
 * Publisher factory. Service-layer code imports from `@/lib/publishing` and
 * never reaches into adapter modules directly.
 */

import { MetaPublisher } from './meta';
import { PublisherError, type Publisher } from './types';

export * from './types';
export { MetaPublisher } from './meta';

export type SupportedChannel = 'instagram' | 'facebook';

const cache = new Map<SupportedChannel, Publisher>();

export function getPublisher(channel: SupportedChannel): Publisher {
  if (channel !== 'instagram' && channel !== 'facebook') {
    throw new PublisherError(
      `No publisher available for channel "${channel}". Only instagram and facebook are supported in v1.`,
      'unsupported_channel',
    );
  }
  const cached = cache.get(channel);
  if (cached) return cached;
  const pub = new MetaPublisher({ channel });
  cache.set(channel, pub);
  return pub;
}

/** Reset cached publishers — useful in tests. */
export function __resetPublishers(): void {
  cache.clear();
}
