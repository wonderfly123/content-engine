"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { ConversationSidebar } from "./thread-list";

const KEY = "nekter.conversations.listHidden";

interface ListToggle {
  hidden: boolean;
  toggle: () => void;
}
const ListContext = createContext<ListToggle | null>(null);

/** Hide or show the conversations column, like ChatGPT's sidebar button (null outside the shell). */
export function ConversationListToggle({ className }: { className?: string }) {
  const ctx = useContext(ListContext);
  if (!ctx) return null;
  const Icon = ctx.hidden ? PanelLeftOpen : PanelLeftClose;
  const label = ctx.hidden ? "Show chats" : "Hide chats";
  return (
    <button
      type="button"
      onClick={ctx.toggle}
      aria-label={label}
      title={label}
      className={cn("hidden rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground md:inline-flex", className)}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}

/** Whether the conversations column is hidden (false outside the shell). */
export const useConversationListHidden = () => useContext(ListContext)?.hidden ?? false;

/**
 * The conversations column beside the open chat, edge to edge under the top bar (cancelling the
 * page padding). On a phone it is one or the other: the list at /conversations, the chat in a thread.
 * On a laptop the column can be hidden; the choice is remembered on this device.
 */
export function ConversationsShell({ children }: { children: React.ReactNode }) {
  const inThread = /^\/conversations\/[^/]+/.test(usePathname());
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    try {
      setHidden(window.localStorage.getItem(KEY) === "1");
    } catch {
      /* no storage: shown */
    }
  }, []);
  const toggle = () =>
    setHidden((h) => {
      try {
        window.localStorage.setItem(KEY, h ? "0" : "1");
      } catch {
        /* ignore */
      }
      return !h;
    });

  return (
    <ListContext.Provider value={{ hidden, toggle }}>
      <div className="-m-6 flex h-[calc(100%+3rem)] min-h-0 overflow-hidden">
        <ConversationSidebar className={cn(inThread ? "hidden" : "flex", hidden ? "md:hidden" : "md:flex")} />
        <section className={cn("relative min-h-0 min-w-0 flex-1", inThread ? "flex" : "hidden md:flex")}>{children}</section>
      </div>
    </ListContext.Provider>
  );
}
