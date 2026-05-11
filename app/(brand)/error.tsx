"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function BrandError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-xl py-10">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle
              className="h-5 w-5 text-destructive"
              aria-hidden="true"
            />
            <CardTitle>Page failed to load</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4" role="alert">
          <p className="text-sm text-muted-foreground">
            {error.message || "An unexpected error occurred."}
          </p>
          {error.digest && (
            <p className="font-mono text-[10px] text-muted-foreground">
              ref: {error.digest}
            </p>
          )}
          <div className="flex gap-2">
            <Button onClick={reset}>Retry</Button>
            <Button asChild variant="outline">
              <a
                href={`mailto:jordan@wonderflyathletics.com?subject=Content%20Engine%20error&body=${encodeURIComponent(
                  `${error.message}\n${error.digest ?? ""}`,
                )}`}
              >
                Report
              </a>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
