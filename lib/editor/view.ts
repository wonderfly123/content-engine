/**
 * What the thread view needs about the editor: each job's cuts (for the reply that carries them)
 * and whether a job is in flight. Only what the page shows; never keys, edit lists or ids of the
 * worker's own, apart from the preview's media id (opened through requireMedia).
 */
import type { ConversationRow } from "@/lib/conversations/store";
import type { EditorJobStatus } from "@/lib/db/enums";
import { EDITOR_STUCK_AFTER_MS, jobsForThread, recoverStuckEditorJobs } from "./jobs";

export interface CutView {
  /** The cut's own label from the worker (stable within one job). */
  key: string;
  title: string;
  seconds: number;
  previewId: string;
  hookOptions: string[];
  caption: string;
}

export interface EditorJobView {
  /** The job's id: a campaign chat approves one plan item's job by id. */
  id: string;
  status: EditorJobStatus;
  costUsd: number | null;
  cuts: CutView[];
  /** Only the thread's latest finished job can be approved (in a campaign: its plan item's latest). */
  approvable: boolean;
  /** What the editor did, step by step, and how long it took (seconds; null while running). */
  steps: Array<{ label: string; at: string }>;
  seconds: number | null;
}

export interface ThreadEditorView {
  jobs: Map<string, EditorJobView>;
  running: boolean;
  /** The running job's steps so far (empty when nothing is running). */
  steps: Array<{ label: string; at: string }>;
  startedAt: string | null;
}

/** Call before reading the thread's messages: a job found stuck is stopped here, with its message. */
export async function threadEditorView(thread: ConversationRow, now: Date = new Date()): Promise<ThreadEditorView> {
  let jobs = await jobsForThread(thread.id, thread.workspaceId);
  const stale = jobs.some(
    (j) => (j.status === "queued" || j.status === "running") && now.getTime() - (j.startedAt ?? j.createdAt).getTime() > EDITOR_STUCK_AFTER_MS,
  );
  if (stale && (await recoverStuckEditorJobs(now, thread.id)) > 0) jobs = await jobsForThread(thread.id, thread.workspaceId);

  const hasCuts = (j: (typeof jobs)[number]) => (j.status === "done" || j.status === "approved") && (j.manifest?.cuts.length ?? 0) > 0;
  const latestDone = jobs.find(hasCuts);
  // Campaign chats have one current cut per plan item; jobs are newest first, so the first seen wins.
  const latestOfItem = new Map<string, string>();
  for (const j of jobs) if (j.campaignItemId && hasCuts(j) && !latestOfItem.has(j.campaignItemId)) latestOfItem.set(j.campaignItemId, j.id);
  const views = new Map<string, EditorJobView>();
  for (const j of jobs) {
    views.set(j.id, {
      id: j.id,
      status: j.status,
      costUsd: j.costUsd === null ? null : Number(j.costUsd),
      cuts: (j.manifest?.cuts ?? []).map((c) => ({
        key: c.id,
        title: c.title,
        seconds: c.seconds,
        previewId: c.preview.mediaId,
        hookOptions: c.hookOptions,
        caption: c.caption,
      })),
      approvable: j.status === "done" && (j.campaignItemId ? latestOfItem.get(j.campaignItemId) === j.id : latestDone?.id === j.id),
      steps: j.progress ?? [],
      seconds: j.startedAt && j.finishedAt ? Math.round((j.finishedAt.getTime() - j.startedAt.getTime()) / 1000) : null,
    });
  }
  const live = jobs.find((j) => j.status === "queued" || j.status === "running");
  return { jobs: views, running: Boolean(live), steps: live?.progress ?? [], startedAt: (live?.startedAt ?? live?.createdAt)?.toISOString() ?? null };
}
