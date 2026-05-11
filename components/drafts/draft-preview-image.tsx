"use client";

import { Card } from "@/components/ui/card";

interface DraftPreviewImageProps {
  caption: string;
  imagePrompts: string[];
}

export function DraftPreviewImage({
  caption,
  imagePrompts,
}: DraftPreviewImageProps) {
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <h3 className="text-sm font-semibold">Caption</h3>
        <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
          {caption || "(empty)"}
        </p>
      </Card>
      {imagePrompts.length > 0 && (
        <Card className="p-4">
          <h3 className="text-sm font-semibold">Image prompts</h3>
          <ul className="mt-2 list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
            {imagePrompts.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
