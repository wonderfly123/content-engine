/**
 * The seam where the AI video editor plugs in.
 *
 * Every inbound message that is not a control message (new reel / new story, an answer to
 * "Reel or story?" or "Which brand?", "yes", carrier keywords) is handed to `handOffToEditor`, and
 * so is the app's "Added N clips" line. It starts a job on the editor worker (lib/editor/submit.ts)
 * and returns what to say back; the caller stores and delivers that reply (TwiML for a text, the
 * API response in the app). The worker's result arrives later through its signed callback
 * (lib/editor/callback.ts), which posts the cuts into the thread.
 *
 * `approvePendingPreview` is the other half: "yes" (or the Approve button) approves only that
 * thread's latest finished cut. Scheduling the post is a later stage; for now it is recorded.
 */
import { approveLatestDone } from "@/lib/editor/jobs";
import { startEditorJob, type EditorHandoff } from "@/lib/editor/submit";

export type { EditorHandoff };

export interface ApprovalResult {
  approved: boolean;
  reason?: string;
}

export async function handOffToEditor(threadId: string, messageId: string, origin?: string | null): Promise<EditorHandoff> {
  return startEditorJob(threadId, messageId, origin);
}

export async function approvePendingPreview(threadId: string): Promise<ApprovalResult> {
  const job = await approveLatestDone(threadId);
  return job ? { approved: true } : { approved: false, reason: "nothing pending" };
}
