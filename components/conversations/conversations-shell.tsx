"use client";

import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { ConversationSidebar } from "./thread-list";

/**
 * The conversations column beside the open chat, edge to edge under the top bar (cancelling the
 * page padding). On a phone it is one or the other: the list at /conversations, the chat in a thread.
 */
export function ConversationsShell({ children }: { children: React.ReactNode }) {
  const inThread = /^\/conversations\/[^/]+/.test(usePathname());
  return (
    <div className="-m-6 flex h-[calc(100%+3rem)] min-h-0">
      <ConversationSidebar className={inThread ? "hidden md:flex" : "flex"} />
      <section className={cn("min-w-0 flex-1", inThread ? "flex" : "hidden md:flex")}>{children}</section>
    </div>
  );
}
