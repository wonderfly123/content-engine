"use client";

import { ThumbsUp, AlertTriangle } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function CalloutCards({
  whatWorks,
  whatToAvoid,
}: {
  whatWorks?: string[];
  whatToAvoid?: string[];
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ThumbsUp className="h-4 w-4 text-emerald-600" />
            What&apos;s working
          </CardTitle>
          <CardDescription>Computed nightly from your analytics.</CardDescription>
        </CardHeader>
        <CardContent>
          {whatWorks && whatWorks.length > 0 ? (
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {whatWorks.slice(0, 3).map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Not enough data yet.</p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            Patterns to avoid
          </CardTitle>
          <CardDescription>Computed nightly from your analytics.</CardDescription>
        </CardHeader>
        <CardContent>
          {whatToAvoid && whatToAvoid.length > 0 ? (
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {whatToAvoid.slice(0, 3).map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Not enough data yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
