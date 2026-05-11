"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  PostDrilldown,
  type DrilldownData,
} from "@/components/analytics/post-drilldown";

export default function PostDrilldownPage() {
  const params = useParams<{ id: string }>();
  const postId = params.id;
  const [data, setData] = useState<DrilldownData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/analytics/post/${postId}`)
      .then((r) => r.json())
      .then((j: { data: DrilldownData | null; error: { code: string } | null }) => {
        if (cancelled) return;
        if (j.data) setData(j.data);
        else setError(j.error?.code ?? "load_failed");
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [postId]);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <Button variant="ghost" size="sm" asChild>
        <Link href="/analytics" className="inline-flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" /> Back to analytics
        </Link>
      </Button>

      {error && (
        <div className="rounded-md border border-destructive bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error === "not_found"
            ? "Post not found."
            : `Could not load post: ${error}`}
        </div>
      )}

      {data ? (
        <PostDrilldown data={data} />
      ) : !error ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : null}
    </div>
  );
}
