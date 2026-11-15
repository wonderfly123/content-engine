/**
 * The seam where the AI video editor plugs in.
 *
 * Every inbound message that is not a control message (new reel / new story, an answer to
 * "Reel or story?" or "Which brand?", "yes", carrier keywords) is handed to `handOffToEditor`.
 * The editor is a Modal worker running headless Claude Code; it is not built yet. When it is, this
 * function will enqueue a job for the worker (thread id + message id; the worker reads the thread
 * itself, makes the change, posts its reply into the thread with `addMessage(..., direction "out")`,
 * texts it back when the thread's last inbound message came by text, and sets
 * `conversations.post_id` when it schedules a post). Until then it records nothing.
 *
 * `approvePendingPreview` is the other half: "yes" approves only that thread's pending preview.
 * There are no previews yet, so there is never anything to approve.
 */

export interface EditorHandoff {
  queued: boolean;
  reason?: string;
}

export interface ApprovalResult {
  approved: boolean;
  reason?: string;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function handOffToEditor(threadId: string, messageId: string): Promise<EditorHandoff> {
  return { queued: false, reason: "editor not connected yet" };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function approvePendingPreview(threadId: string): Promise<ApprovalResult> {
  return { approved: false, reason: "nothing pending" };
}
