/**
 * Listeners told when a post goes live (the publish cron's markPostPublished), e.g. to text the
 * person whose conversation made it "it's live: <link>". Register at module load in a file the
 * cron route imports. A listener's failure is logged and never undoes or blocks the publish.
 */
export interface PublishedPost {
  postId: string;
  brandId: string;
  /** Instagram's permalink, when it could be fetched ("" otherwise). */
  externalUrl: string;
  /** The conversations whose `post_id` is this post (still open at publish time, then closed). */
  conversationIds: string[];
}

export type PublishedListener = (post: PublishedPost) => Promise<void> | void;

const listeners = new Set<PublishedListener>();

/** Adds a listener; returns a function that removes it. */
export function onPostPublished(listener: PublishedListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function notifyPostPublished(post: PublishedPost): Promise<void> {
  for (const listener of listeners) {
    try {
      await listener(post);
    } catch (err) {
      console.error(`[publish] post=${post.postId} published listener failed: ${(err as Error).message}`);
    }
  }
}
