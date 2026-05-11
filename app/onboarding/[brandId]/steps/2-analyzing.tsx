"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface Step2Props {
  brandId: string;
  /** True if `settings_json.onboarding.draftProfile` already exists. */
  alreadyAnalyzed?: boolean;
}

const PHASES = [
  { label: "Scraping site…", durationMs: 8_000 },
  { label: "Extracting persona…", durationMs: 12_000 },
  { label: "Drafting ICP…", durationMs: 6_000 },
] as const;

export function Step2Analyzing({ brandId, alreadyAnalyzed }: Step2Props) {
  const router = useRouter();
  const [phase, setPhase] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    if (alreadyAnalyzed) {
      router.replace(`/onboarding/${brandId}?step=3`);
      return;
    }

    // Drive phase indicator on a rough schedule independent of network time.
    const timers: ReturnType<typeof setTimeout>[] = [];
    let acc = 0;
    for (let i = 1; i < PHASES.length; i++) {
      acc += PHASES[i - 1]!.durationMs;
      timers.push(setTimeout(() => setPhase((p) => Math.max(p, i)), acc));
    }

    (async () => {
      try {
        const res = await fetch(`/api/brands/${brandId}/analyze`, {
          method: "POST",
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.detail ?? j.error ?? `HTTP ${res.status}`);
        }
        router.replace(`/onboarding/${brandId}?step=3`);
      } catch (err) {
        const msg = (err as Error).message;
        setError(msg);
        toast.error(`Analysis failed: ${msg}`);
      }
    })();

    return () => {
      for (const t of timers) clearTimeout(t);
    };
  }, [brandId, alreadyAnalyzed, router]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Analyzing your brand…</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ol className="space-y-2">
            {PHASES.map((p, i) => {
              const done = i < phase || (!error && phase === PHASES.length - 1 && i <= phase);
              const active = i === phase && !error;
              return (
                <li
                  key={p.label}
                  className={cn(
                    "flex items-center gap-2 text-sm",
                    active && "text-foreground",
                    !active && !done && "text-muted-foreground",
                  )}
                >
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
          {error && (
            <p className="text-sm text-destructive">
              {error}. You can refresh to retry.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Drafted profile preview</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    </div>
  );
}
