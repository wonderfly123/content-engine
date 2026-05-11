"use client";

import { Card } from "@/components/ui/card";

interface ReelShot {
  index: number;
  durationSec: number;
  onScreenText?: string | null;
  bRollNotes?: string | null;
}

interface ReelScript {
  hookScore?: number;
  targetDurationSec?: number;
  coverImagePrompt?: string | null;
  shots: ReelShot[];
}

interface DraftPreviewReelProps {
  scriptJson: ReelScript | null;
  caption: string;
}

export function DraftPreviewReel({ scriptJson, caption }: DraftPreviewReelProps) {
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <h3 className="text-sm font-semibold">Caption</h3>
        <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
          {caption || "(empty)"}
        </p>
      </Card>
      {scriptJson && (
        <Card className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Reel script</h3>
            <div className="flex gap-3 text-xs text-muted-foreground">
              {typeof scriptJson.hookScore === "number" && (
                <span>Hook score: {scriptJson.hookScore.toFixed(2)}</span>
              )}
              {scriptJson.targetDurationSec && (
                <span>~{scriptJson.targetDurationSec}s</span>
              )}
            </div>
          </div>
          <ol className="mt-3 space-y-3">
            {scriptJson.shots.map((shot) => (
              <li key={shot.index} className="border-l-2 pl-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-mono">Shot {shot.index}</span>
                  <span>·</span>
                  <span>{shot.durationSec}s</span>
                </div>
                {shot.onScreenText && (
                  <p className="mt-1 text-sm font-medium">
                    “{shot.onScreenText}”
                  </p>
                )}
                {shot.bRollNotes && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    B-roll: {shot.bRollNotes}
                  </p>
                )}
              </li>
            ))}
          </ol>
          {scriptJson.coverImagePrompt && (
            <p className="mt-3 text-xs text-muted-foreground">
              <span className="font-medium">Cover prompt: </span>
              {scriptJson.coverImagePrompt}
            </p>
          )}
        </Card>
      )}
    </div>
  );
}
