"use client";

import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";

interface CompetitorFinding {
  competitorId?: string;
  handle?: string;
  url?: string;
  topPosts?: Array<{
    url?: string;
    caption?: string;
    likes?: number;
    comments?: number;
    note?: string;
  }>;
  themes?: string[];
}

interface CompetitorFindingsProps {
  findings: CompetitorFinding[];
}

export function CompetitorFindings({ findings }: CompetitorFindingsProps) {
  if (findings.length === 0) {
    return (
      <EmptyState
        title="No competitor findings"
        description="Add competitors in Settings then refresh research."
      />
    );
  }
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {findings.map((f, i) => (
        <Card key={`${f.competitorId ?? f.handle ?? i}`}>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="truncate text-base">
                @{f.handle ?? "competitor"}
              </CardTitle>
              {f.url && (
                <a
                  href={f.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="Open competitor profile"
                >
                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                </a>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {f.themes && f.themes.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {f.themes.map((t) => (
                  <Badge key={t} variant="outline" className="text-xs">
                    {t}
                  </Badge>
                ))}
              </div>
            )}
            {f.topPosts && f.topPosts.length > 0 && (
              <ul className="space-y-2 text-sm">
                {f.topPosts.slice(0, 3).map((p, j) => (
                  <li key={j} className="border-l-2 pl-3">
                    {p.caption && (
                      <p className="line-clamp-2 text-sm">{p.caption}</p>
                    )}
                    <p className="mt-1 text-xs text-muted-foreground">
                      {p.likes ? `${p.likes} likes` : null}
                      {p.likes && p.comments ? " · " : null}
                      {p.comments ? `${p.comments} comments` : null}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
