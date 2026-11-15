import { ThreadView } from "@/components/conversations/thread-view";

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="mx-auto max-w-3xl">
      <ThreadView id={id} />
    </div>
  );
}
