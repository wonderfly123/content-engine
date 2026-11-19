/**
 * After a cut is ready: approve it, then say when it posts. The same steps for a text ("yes", then
 * "tonight"), the watch page (app/w) and the app's thread view, so all three stay in step.
 *
 *   ready (job done) -> approved (job approved, no post) -> scheduled (queued post) -> posted
 *
 * Unscheduling (UNDO; never "cancel", which carriers treat as an opt-out) takes it back to approved.
 */
import type { ConversationAccess } from "@/lib/conversations/access";
import { describePostTime } from "@/lib/conversations/post-time";
import type { EditorCut } from "@/lib/editor/manifest";
import { approveLatestDone, latestFinishedJob } from "@/lib/editor/jobs";
import { cancelScheduledPost, scheduledPostFor, scheduleEditorCut } from "@/lib/editor/schedule";
import { learnInBackground } from "@/lib/editor/style-learning";

export const ASK_WHEN = 'When should it post? Reply NOW, TONIGHT, or a time like "tomorrow 9am".';
export const UNDO_WORDS = new Set(["undo", "unschedule", "dont post", "don't post", "hold", "wait"]);

export type CutStage = "ready" | "approved" | "scheduled" | "posted";

export interface CurrentCut {
  jobId: string;
  stage: CutStage;
  cut: EditorCut;
  post: { postId: string; status: string; when: Date } | null;
}

/** The thread's newest finished cut and where it stands, or null when there is none yet. */
export async function currentCut(threadId: string): Promise<CurrentCut | null> {
  const job = await latestFinishedJob(threadId);
  const cut = (job?.manifest as { cuts?: EditorCut[] } | null)?.cuts?.[0];
  if (!job || !cut) return null;
  const post = await scheduledPostFor(job.id, cut.id);
  const stage: CutStage =
    post?.status === "published" ? "posted" : post && post.status !== "rejected" ? "scheduled" : job.status === "approved" ? "approved" : "ready";
  return { jobId: job.id, stage, cut, post };
}

export async function approveCut(threadId: string): Promise<boolean> {
  const job = await approveLatestDone(threadId);
  // May suggest a tweak to the brand's editor style; never holds up the approval.
  if (job) learnInBackground({ jobId: job.id, source: "approved" });
  return job !== null;
}

export interface Scheduled {
  postId: string;
  when: Date;
  /** "Posting now." / "Scheduled for today at 7:00 PM." */
  line: string;
}

/** Schedules the thread's approved cut (approving it first if it was only ready). */
export async function scheduleCurrentCut(access: ConversationAccess, when: Date, now = false): Promise<Scheduled | null> {
  const current = await currentCut(access.conversation.id);
  if (!current || current.stage === "posted") return null;
  if (current.stage === "ready") await approveCut(access.conversation.id);
  // Trial reel by default (shown to non-followers first), like the montage skill.
  const done = await scheduleEditorCut({ access, jobId: current.jobId, cutId: current.cut.id, when });
  const line = now ? "Posting now. I'll text you the link when it's live." : `Scheduled for ${describePostTime(done.when)}.`;
  return { postId: done.postId, when: done.when, line };
}

/** Takes a scheduled cut off the calendar (it stays approved). */
export async function unscheduleCurrentCut(access: ConversationAccess): Promise<boolean> {
  const current = await currentCut(access.conversation.id);
  if (!current?.post || current.stage !== "scheduled") return false;
  return cancelScheduledPost(current.post.postId, access.workspaceId);
}
