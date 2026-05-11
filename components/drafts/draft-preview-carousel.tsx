"use client";

import { Card } from "@/components/ui/card";

interface Slide {
  index: number;
  copy: string;
  imagePrompt?: string | null;
  styleHint?: string | null;
}

interface DraftPreviewCarouselProps {
  slideJson: Slide[] | null;
  caption: string;
}

export function DraftPreviewCarousel({
  slideJson,
  caption,
}: DraftPreviewCarouselProps) {
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <h3 className="text-sm font-semibold">Caption</h3>
        <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
          {caption || "(empty)"}
        </p>
      </Card>
      {slideJson && slideJson.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {slideJson.map((s) => (
            <Card key={s.index} className="overflow-hidden p-4">
              <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                <span className="font-mono">Slide {s.index}</span>
                {s.styleHint && <span>{s.styleHint}</span>}
              </div>
              <p className="text-sm font-medium">{s.copy}</p>
              {s.imagePrompt && (
                <p className="mt-3 rounded-md bg-muted/50 p-2 text-xs italic text-muted-foreground">
                  {s.imagePrompt}
                </p>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
