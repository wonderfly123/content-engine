"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Status = "idle" | "running" | "done" | "failed";

/** What the page shows while it waits; the research itself does not report its phases. */
const PHASES = [
  { label: "Reading your website", at: 0 },
  { label: "Reading your about, menu and services pages", at: 15 },
  { label: "Searching the web for your brand", at: 35 },
  { label: "Learning your voice", at: 55 },
  { label: "Drafting your profile and brand facts", at: 75 },
];
const POLL_MS = 3000;

/** Step 4: starts the background research, polls until it is done, then opens the review. */
export function ResearchProgress({ brandId, hasWebsite }: { brandId: string; hasWebsite: boolean }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const started = useRef(false);
  const url = `/api/brands/${brandId}/research`;

  const begin = useCallback(
    async (restart: boolean) => {
      setError(null);
      setElapsed(0);
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ restart }) });
      const body = (await res.json().catch(() => ({}))) as { status?: Status; error?: string };
      if (!res.ok && res.status !== 202) {
        setStatus("failed");
        setError(body.error ?? "Could not start the research.");
        return;
      }
      setStatus(body.status ?? "running");
    },
    [url],
  );

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      const res = await fetch(url, { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as { status?: Status };
      if (body.status === "running" || body.status === "done") setStatus(body.status);
      else await begin(false);
    })();
  }, [url, begin]);

  useEffect(() => {
    if (status === "done") {
      router.replace(`/onboarding/${brandId}?step=5`);
      return;
    }
    if (status !== "running") return;
    const tick = setInterval(() => setElapsed((s) => s + 1), 1000);
    const poll = setInterval(async () => {
      const res = await fetch(url, { cache: "no-store" }).catch(() => null);
      if (!res?.ok) return;
      const body = (await res.json().catch(() => ({}))) as { status?: Status };
      if (body.status && body.status !== "running") setStatus(body.status);
    }, POLL_MS);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [status, url, brandId, router]);

  const phases = hasWebsite ? PHASES : PHASES.slice(2);
  const current = phases.reduce((n, p, i) => (elapsed >= p.at - (hasWebsite ? 0 : 35) ? i : n), 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Researching your brand</CardTitle>
        <CardDescription>This takes about a minute. You can leave this page; it carries on and you can come back.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ol className="space-y-2">
          {phases.map((p, i) => {
            const done = status === "done" || i < current;
            const active = status === "running" && i === current;
            return (
              <li key={p.label} className={cn("flex items-center gap-2 text-sm", !active && !done && "text-muted-foreground")}>
                {done ? (
                  <Check className="h-4 w-4 text-green-600" aria-hidden="true" />
                ) : active ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <span className="h-4 w-4 rounded-full border" aria-hidden="true" />
                )}
                {p.label}
              </li>
            );
          })}
        </ol>
        {status === "running" && elapsed > 120 && (
          <p className="text-sm text-muted-foreground">Still working. Bigger websites take a little longer.</p>
        )}
        {status === "failed" && (
          <div className="space-y-2">
            <p className="text-sm text-destructive" role="alert">
              {error ?? "The research stopped before it finished."}
            </p>
            <Button onClick={() => void begin(true)}>Try again</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
