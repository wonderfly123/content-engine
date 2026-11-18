"use client";

import { NewThreadButtons } from "@/components/conversations/shared";
import { TextEditorBanner } from "@/components/conversations/text-editor-banner";
import { useActiveBrandId, useThreads } from "@/components/conversations/thread-list";

/** No chat open yet: what to make, like ChatGPT's empty page. */
export default function ConversationsPage() {
  const brandId = useActiveBrandId();
  const { data } = useThreads(brandId);
  return (
    <div className="flex w-full flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="space-y-2">
        <h2 className="text-3xl font-semibold tracking-tight">What are we making?</h2>
        <p className="text-muted-foreground">Start a reel or a story, add your clips, and the editor cuts it. Or pick a conversation on the left.</p>
      </div>
      <NewThreadButtons brandId={brandId} size="default" />
      {data && brandId && <TextEditorBanner info={data} brandId={brandId} className="w-full max-w-md text-left" />}
    </div>
  );
}
