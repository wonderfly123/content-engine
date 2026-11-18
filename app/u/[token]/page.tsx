/**
 * /u/[token] — the page an upload link opens (texted after "new reel" / "new story"). No sign-in:
 * the token is the key, and only lets its holder add clips to that one open thread
 * (lib/conversations/upload-link.ts). Phone-first: one button to pick clips, progress per clip.
 */
import type { Metadata } from "next";
import { AccessError } from "@/lib/auth/workspace";
import { requireUploadLink } from "@/lib/conversations/upload-link";
import { UploadLinkClient } from "./upload-link-client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Add your clips · Nekter", robots: { index: false, follow: false } };

function Message({ title, body }: { title: string; body: string }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-2 px-5 text-center">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="text-muted-foreground">{body}</p>
    </main>
  );
}

export default async function UploadLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let access;
  try {
    access = await requireUploadLink(token);
  } catch (err) {
    if (!(err instanceof AccessError)) throw err;
    return err.status === 403 ? (
      <Message title="This link has expired" body={'Text "new reel" or "new story" to get a fresh one.'} />
    ) : (
      <Message title="Link not found" body="Check you opened the whole link from the text." />
    );
  }
  if (access.conversation.status !== "open") {
    return <Message title="This one is finished" body={'Text "new reel" or "new story" to start another.'} />;
  }
  const kind = access.conversation.kind === "story" ? "story" : access.conversation.kind === "reel" ? "reel" : "video";
  return <UploadLinkClient token={token} conversationId={access.conversation.id} title={access.conversation.title ?? `New ${kind}${access.brandName ? ` for ${access.brandName}` : ""}`} named={Boolean(access.conversation.title)} />;
}
