/**
 * /api/brands/[id]/research — onboarding step 4.
 *   POST { restart?: boolean } → start the brand research in the background (202), or report the run
 *                                already under way / finished.
 *   GET                        → where the research is: { status: "idle" | "running" | "done" | "failed", fallback? }
 *
 * The research (Claude with web fetch and web search on the workspace's own key) can take a minute
 * or more, so it never runs inside the request: it is handed to `after()`, which keeps the function
 * alive up to `maxDuration` once the response is sent, and the page polls GET.
 */
import { after, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { guard, requireBrand } from "@/lib/auth/workspace";
import { db } from "@/lib/db";
import { brands } from "@/lib/db/schema";
import { flowStateOf, researchIsRunning, type FlowState } from "@/lib/onboarding/flow";
import { runResearchJob, updateFlowState } from "@/lib/onboarding/flow-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const bodySchema = z.object({ restart: z.boolean().optional() }).default({});

async function stateOf(brandId: string): Promise<FlowState | null> {
  const [row] = await db.select({ settingsJson: brands.settingsJson }).from(brands).where(eq(brands.id, brandId));
  return row ? flowStateOf(row.settingsJson) : null;
}

function view(state: FlowState) {
  if (researchIsRunning(state)) return { status: "running" as const };
  if (state.research?.status === "done" && state.draft) return { status: "done" as const, fallback: state.draft.fallback };
  if (state.research?.status === "failed" || state.research?.status === "running") return { status: "failed" as const };
  return { status: "idle" as const };
}

export const GET = guard(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { brandId } = await requireBrand((await params).id);
  const state = await stateOf(brandId);
  if (!state) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json(view(state));
});

export const POST = guard(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { brandId } = await requireBrand((await params).id);
  const body = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const state = await stateOf(brandId);
  if (!state) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (!state.about?.summary) return NextResponse.json({ error: "Tell us about the brand first." }, { status: 409 });

  const current = view(state);
  if (current.status === "running" || (current.status === "done" && !body.data.restart)) return NextResponse.json(current);

  await updateFlowState(brandId, { currentStep: 4, research: { status: "running", startedAt: new Date().toISOString() } });
  after(() => runResearchJob(brandId));
  return NextResponse.json({ status: "running" }, { status: 202 });
});
