import { ConversationsShell } from "@/components/conversations/conversations-shell";

/** Conversations, laid out like ChatGPT: the thread list on the left, the open chat beside it. */
export default function ConversationsLayout({ children }: { children: React.ReactNode }) {
  return <ConversationsShell>{children}</ConversationsShell>;
}
