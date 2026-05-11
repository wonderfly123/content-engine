"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";

interface KeywordFinding {
  keyword?: string;
  term?: string;
  volume?: number;
  signals?: string[];
  notes?: string;
}

interface KeywordFindingsProps {
  findings: KeywordFinding[];
}

export function KeywordFindings({ findings }: KeywordFindingsProps) {
  if (findings.length === 0) {
    return (
      <EmptyState
        title="No keyword data"
        description="Add tracked keywords in Settings and trigger a research pull."
      />
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Keyword pulse</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y" role="list">
          {findings.map((k, i) => (
            <li
              key={`${k.keyword ?? k.term ?? i}`}
              className="flex items-center justify-between py-2 text-sm"
            >
              <span className="font-medium">{k.keyword ?? k.term}</span>
              <div className="flex items-center gap-2">
                {k.signals?.slice(0, 3).map((s) => (
                  <Badge key={s} variant="outline" className="text-xs">
                    {s}
                  </Badge>
                ))}
                {typeof k.volume === "number" && (
                  <span className="text-xs text-muted-foreground">
                    vol {k.volume}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
