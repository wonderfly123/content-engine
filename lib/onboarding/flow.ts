/**
 * The brand-voice onboarding flow: its steps, the progress it keeps on `brands.settings_json.onboarding`,
 * and the rule for who gets sent into it.
 *
 *  1 Welcome          your name and the brand's name (creates the draft brand)
 *  2 Connect Claude   the workspace's own Anthropic key (skipped when one already works)
 *  3 About            website, Instagram handle, one sentence, optional captions
 *  4 Research         Claude reads the site and searches for the brand, in the background
 *  5 Review           edit the drafted profile and brand facts
 *  6 Extras           Instagram and texting, both optional
 *  7 Done
 */
import type { BrandFact } from "@/lib/db/types";

/** Marks progress written by this flow (earlier wizards wrote no `flow`). */
export const FLOW_VERSION = 3;

export const FLOW_STEPS = [
  { n: 1, label: "Welcome" },
  { n: 2, label: "Connect Claude" },
  { n: 3, label: "About" },
  { n: 4, label: "Research" },
  { n: 5, label: "Review" },
  { n: 6, label: "Extras" },
  { n: 7, label: "Done" },
] as const;

export const FLOW_STEP_COUNT = FLOW_STEPS.length;

/** A research run that has said "running" for longer than this has died; it may be started again. */
export const RESEARCH_STALE_MS = 6 * 60_000;

export interface ResearchProfile {
  whatTheyDo: string;
  whoItsFor: string;
  voice: { tone: string; wordsTheyUse: string[]; wordsToAvoid: string[] };
  facts: Required<BrandFact>[];
  exampleCaptions: string[];
}

export interface ResearchDraft {
  profile: ResearchProfile;
  /** Pages the research actually read. */
  sources: string[];
  /** True when the web research failed and the draft came from what they typed. */
  fallback: boolean;
  /** A plain sentence for the review page when something went wrong. */
  note?: string;
}

export interface ResearchStatus {
  status: "running" | "done" | "failed";
  startedAt: string;
  finishedAt?: string;
  error?: string;
}

export interface AboutInput {
  instagramHandle?: string;
  summary: string;
  /** Captions they pasted (used only when no Instagram account is connected). */
  captions: string[];
}

export interface FlowState {
  flow?: number;
  currentStep?: number;
  about?: AboutInput;
  research?: ResearchStatus;
  draft?: ResearchDraft;
}

/** The onboarding progress stored on a brand, or {} when there is none. */
export function flowStateOf(settings: unknown): FlowState {
  const raw = (settings as { onboarding?: unknown } | null)?.onboarding;
  return raw && typeof raw === "object" ? (raw as FlowState) : {};
}

/**
 * The step a draft brand resumes on. A draft left by an earlier wizard already has its description,
 * so it picks up at "About" and runs the new research from there.
 */
export function resumeStep(state: FlowState): number {
  if (state.flow !== FLOW_VERSION) return 3;
  const n = Number(state.currentStep);
  if (!Number.isInteger(n)) return 2;
  return Math.min(FLOW_STEP_COUNT, Math.max(2, n));
}

/** True while a research run is under way and not stale. */
export function researchIsRunning(state: FlowState, now = Date.now()): boolean {
  const r = state.research;
  if (r?.status !== "running") return false;
  const started = Date.parse(r.startedAt);
  return Number.isFinite(started) && now - started < RESEARCH_STALE_MS;
}

export interface BrandSummary {
  status: string;
  settingsJson: unknown;
}

/**
 * Whether a signed-in user must finish onboarding before using the app: they can reach no brand at
 * all, or only drafts this flow started. The platform admin is never sent; neither is anyone with an
 * active brand, nor anyone whose only brands are older drafts or archived (existing users).
 */
export function needsOnboarding(input: { isPlatformAdmin: boolean; hasWorkspace: boolean; brands: BrandSummary[] }): boolean {
  if (input.isPlatformAdmin || !input.hasWorkspace) return false;
  if (input.brands.length === 0) return true;
  return input.brands.every((b) => b.status === "draft" && flowStateOf(b.settingsJson).flow === FLOW_VERSION);
}

/** Lowercase letters, digits and hyphens, from a brand name. */
export function slugFromName(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-+|-+$)/g, "")
      .slice(0, 50) || "brand"
  );
}
