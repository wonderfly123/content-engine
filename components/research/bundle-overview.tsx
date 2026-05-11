"use client";

import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface BundleOverviewProps {
  pulledAt: string | null;
  status: "fresh" | "stale" | "partial";
  llmPatternSummary: string;
  errorNotes: string | null;
}

export function BundleOverview({
  pulledAt,
  status,
  llmPatternSummary,
  errorNotes,
}: BundleOverviewProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>Latest research</CardTitle>
          <Badge
            variant={
              status === "fresh"
                ? "default"
                : status === "partial"
                  ? "secondary"
                  : "outline"
            }
            className="capitalize"
          >
            {status}
          </Badge>
        </div>
        {pulledAt && (
          <p className="text-xs text-muted-foreground">
            Pulled {format(new Date(pulledAt), "PP p")}
          </p>
        )}
      </CardHeader>
      <CardContent>
        {llmPatternSummary ? (
          <p className="whitespace-pre-wrap text-sm">{llmPatternSummary}</p>
        ) : (
          <p className="text-sm text-muted-foreground">
            No pattern summary yet.
          </p>
        )}
        {errorNotes && (
          <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {errorNotes}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
