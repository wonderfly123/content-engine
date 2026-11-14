"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Maximize2 } from "lucide-react";
import { useBrandStore } from "@/lib/stores/brand-store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FinalReview } from "@/components/reels/final-review";
import { ReviewAndEdit } from "@/components/reels/review-and-edit";
import { Player, Split, keyOf, mediaUrl } from "@/components/reels/shared";
import type { ReelCutView } from "@/lib/reels/store";

const STAGES = {
  // "voiceover" is the old separate recording stage; cuts left there finish in the same combined step.
  cuts: { title: "Review and edit", blurb: "Watch each cut and trim it if needed. Add a voice-over or choose none, pick the opening text, then accept.", show: ["cut_review", "voiceover"] },
  final: { title: "Final review", blurb: "Finished videos. Confirm the cover and caption, then pick a time to put them on the calendar.", show: ["final_review", "editing", "scheduled"] },
} as const;
type StageKey = keyof typeof STAGES;

const TILE_ACTION: Record<string, string> = { cut_review: "Review and edit", voiceover: "Review and edit", final_review: "Review and schedule", editing: "With the editor", scheduled: "Scheduled" };
const inFirstReview = (cut: ReelCutView) => cut.stage === "cut_review" || cut.stage === "voiceover";
const modeLabel = (cut: ReelCutView) => (cut.mode === "voice" ? "voice-over" : "no voice-over");

/** What the editor is working on for a cut that was accepted and handed over. */
function editorStatus(cut: ReelCutView): string {
  if (cut.note) return `Changes requested: ${cut.note}`;
  const todo = [
    cut.edits && "your edit",
    cut.voiceover && "the voice-over mix and captions",
    (cut.hook ?? "") !== (cut.hookBurned ?? "") && "the opening text",
  ].filter(Boolean);
  return todo.length ? `Waiting for ${todo.join(", ")}.` : "Waiting for the finished file and caption.";
}

export default function InstagramPipelinePage() {
  const params = useParams<{ stage: string }>();
  const stageKey: StageKey = params.stage in STAGES ? (params.stage as StageKey) : "cuts";
  const stage = STAGES[stageKey];
  const brand = useBrandStore((s) => s.active);
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["reels"] });
  const [openKey, setOpenKey] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["reels", brand?.slug],
    queryFn: async () => {
      const res = await fetch(`/api/reels?brand=${encodeURIComponent(brand!.slug)}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return ((await res.json()) as { cuts: ReelCutView[] }).cuts;
    },
    enabled: Boolean(brand?.slug),
    refetchInterval: 15_000,
  });

  const cuts = (data ?? []).filter((c) => (stage.show as readonly string[]).includes(c.stage));
  const order = (c: ReelCutView) => stage.show.indexOf(c.stage as never);
  cuts.sort((a, b) => order(a) - order(b) || a.job.localeCompare(b.job) || a.seconds - b.seconds);
  // The dialog follows the list: when a cut leaves this stage (approved, sent back), it closes by itself.
  const openCut = cuts.find((c) => keyOf(c) === openKey) ?? null;
  // One section per video length, shortest first.
  const lengths = [...new Set(cuts.map((c) => c.seconds))].sort((x, y) => x - y);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
      <header>
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Review Pipeline · Instagram Reels</p>
        <h1 className="text-2xl font-semibold">{stage.title}</h1>
        <p className="text-sm text-muted-foreground">{stage.blurb}</p>
      </header>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!isLoading && cuts.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Nothing here for {brand?.name ?? "this brand"}. Cuts appear when the video skill adds them to a job.
          </CardContent>
        </Card>
      )}

      {lengths.map((len) => (
      <section key={len} className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">{len} seconds <span className="font-normal text-muted-foreground">· {cuts.filter((c) => c.seconds === len).length}</span></h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {cuts.filter((c) => c.seconds === len).map((cut) => (
          <Card key={keyOf(cut)} className="overflow-hidden">
            <CardContent className="flex flex-col gap-2 p-3">
              <button type="button" onClick={() => setOpenKey(keyOf(cut))} className="block w-full" aria-label={`Open ${cut.title}`}>
                <video src={`${mediaUrl(cut, cut.final ?? cut.preview)}#t=${(cut.coverAt ?? 1).toFixed(2)}`} muted playsInline preload="metadata" className="aspect-[9/16] w-full rounded-md bg-black object-cover" />
              </button>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{cut.title}</p>
                  <p className="truncate text-xs text-muted-foreground">{cut.job}{inFirstReview(cut) ? "" : ` · ${modeLabel(cut)}`}</p>
                </div>
                <button type="button" onClick={() => setOpenKey(keyOf(cut))} className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Expand ${cut.title}`}>
                  <Maximize2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
              <Button size="sm" variant={cut.stage === "editing" || cut.stage === "scheduled" ? "outline" : "default"} onClick={() => setOpenKey(keyOf(cut))}>{TILE_ACTION[cut.stage] ?? "Open"}</Button>
            </CardContent>
          </Card>
        ))}
        </div>
      </section>
      ))}

      <Dialog open={Boolean(openCut)} onOpenChange={(o) => { if (!o) setOpenKey(null); }}>
        <DialogContent className="max-h-[94vh] w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-4xl">
          {openCut && (
            <>
              <DialogHeader>
                <DialogTitle>{openCut.title}</DialogTitle>
                <DialogDescription>{openCut.job} · {openCut.seconds}s{inFirstReview(openCut) ? "" : ` · ${modeLabel(openCut)}`}</DialogDescription>
              </DialogHeader>
              {inFirstReview(openCut) && <ReviewAndEdit key={keyOf(openCut)} cut={openCut} onDone={refresh} />}
              {openCut.stage === "final_review" && <FinalReview key={keyOf(openCut)} cut={openCut} onDone={refresh} />}
              {openCut.stage === "editing" && (
                <Split video={<Player cut={openCut} file={openCut.preview} />}>
                  <Badge variant="outline" className="w-fit">With the editor</Badge>
                  <p className="text-sm text-muted-foreground">{editorStatus(openCut)}</p>
                </Split>
              )}
              {openCut.stage === "scheduled" && (
                <Split video={<Player cut={openCut} file={openCut.final ?? openCut.preview} />}>
                  <Badge className="w-fit">Scheduled</Badge>
                  <p className="text-sm text-muted-foreground">
                    {openCut.scheduledFor ? new Date(openCut.scheduledFor).toLocaleString() : ""} · {openCut.trial ? "trial Reel" : "normal Reel"}. See the Calendar.
                  </p>
                  {openCut.caption && <p className="whitespace-pre-wrap text-sm">{openCut.caption}</p>}
                </Split>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
