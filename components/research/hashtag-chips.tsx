"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface TrendingHashtag {
  tag?: string;
  hashtag?: string;
  score?: number;
}

interface HashtagChipsProps {
  hashtags: TrendingHashtag[];
}

export function HashtagChips({ hashtags }: HashtagChipsProps) {
  if (hashtags.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Trending hashtags</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-1.5">
          {hashtags.map((h, i) => {
            const tag = h.tag ?? h.hashtag ?? `tag${i}`;
            return (
              <Badge key={tag} variant="secondary">
                #{tag.replace(/^#/, "")}
                {typeof h.score === "number" && (
                  <span className="ml-1 text-[10px] opacity-60">
                    {h.score.toFixed(1)}
                  </span>
                )}
              </Badge>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
