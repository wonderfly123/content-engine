"use client";

import { useEffect } from "react";
import { AlertOctagon } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface in browser console; production wiring (e.g. Sentry) is a follow-up.
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div
        role="alert"
        className="max-w-md space-y-4 rounded-lg border bg-card p-6 text-center"
      >
        <AlertOctagon
          className="mx-auto h-8 w-8 text-destructive"
          aria-hidden="true"
        />
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="text-sm text-muted-foreground">
          {error.message || "An unexpected error occurred."}
        </p>
        {error.digest && (
          <p className="font-mono text-[10px] text-muted-foreground">
            ref: {error.digest}
          </p>
        )}
        <div className="flex justify-center gap-2">
          <Button onClick={reset} variant="default">
            Try again
          </Button>
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
      </div>
    </div>
  );
}
