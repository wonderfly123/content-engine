"use client";

import { useState } from "react";
import { NewThreadButtons } from "@/components/conversations/shared";
import { ThreadView } from "@/components/conversations/thread-view";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

/**
 * New reel / New story on the dashboard. Starts the same conversation a text would, and opens
 * it in a side panel so the back-and-forth happens right here.
 */
export function StartVideo({ brandId }: { brandId: string | undefined }) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <>
      <NewThreadButtons brandId={brandId} size="default" onStarted={setOpenId} />
      <Sheet open={openId !== null} onOpenChange={(open) => !open && setOpenId(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>Talk to the editor</SheetTitle>
            <SheetDescription>Same conversation as texting. It is saved under Conversations.</SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-6">{openId && <ThreadView id={openId} compact onSwitch={setOpenId} />}</div>
        </SheetContent>
      </Sheet>
    </>
  );
}
