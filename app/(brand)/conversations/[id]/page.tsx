import { ThreadView } from "@/components/conversations/thread-view";

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <ThreadView id={id} />
  );
}
