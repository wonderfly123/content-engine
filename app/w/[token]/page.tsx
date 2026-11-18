/**
 * /w/[token] — the page a "your cut is ready" text links to. No sign-in: the watch link's token is
 * the key, for this one video only. Phone-first: the cut at full quality, its caption, and the next
 * step (approve or ask for changes; then when it posts; then unschedule until it's live).
 */
import type { Metadata } from "next";
import { AccessError } from "@/lib/auth/workspace";
import { requireWatchLink } from "@/lib/conversations/upload-link";
import { currentCut } from "@/lib/editor/approval";
import { presignGet } from "@/lib/storage/r2";
import { WatchClient } from "./watch-client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your cut · Nekter", robots: { index: false, follow: false } };

function Message({ title, body }: { title: string; body: string }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-2 px-5 text-center">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="text-muted-foreground">{body}</p>
    </main>
  );
}

export default async function WatchPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let access;
  try {
    access = await requireWatchLink(token);
  } catch (err) {
    if (!(err instanceof AccessError)) throw err;
    return err.status === 403 ? <Message title="This link has expired" body="Text the number again for a fresh one." /> : <Message title="Link not found" body="Check you opened the whole link from the text." />;
  }
  const current = await currentCut(access.conversation.id);
  if (!current) return <Message title="No cut yet" body="The editor is still working on it. We'll text you when it's ready." />;
  const c = access.conversation;
  return (
    <WatchClient
      token={token}
      title={c.title ?? current.cut.title}
      subtitle={[c.kind === "story" ? "Story" : "Reel", `${Math.round(current.cut.seconds)}s`, access.brandName].filter(Boolean).join(" · ")}
      videoUrl={presignGet(current.cut.preview.key, 6 * 3600)}
      caption={current.cut.caption}
      initialStage={c.status === "open" ? current.stage : "posted"}
      scheduledFor={current.post?.when?.toISOString() ?? null}
      story={c.kind === "story"}
    />
  );
}
