"use client";

import { useState, useTransition } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pause, Play, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  addKeyword,
  deleteKeyword,
  pullKeywordNow,
  setKeywordStatus,
} from "./actions";
import { EmptyState } from "@/components/empty-state";
import { Skeleton } from "@/components/ui/skeleton";

interface KeywordRow {
  id: string;
  term: string;
  status: "active" | "paused";
  lastPulledAt: string | null;
}

async function fetchKeywords(brandId: string): Promise<KeywordRow[]> {
  const res = await fetch(`/api/keywords?brandId=${brandId}`, {
    cache: "no-store",
  });
  if (!res.ok) return [];
  const json = (await res.json()) as { keywords: KeywordRow[] };
  return json.keywords;
}

export function KeywordsTab({ brandId }: { brandId: string }) {
  const qc = useQueryClient();
  const [term, setTerm] = useState("");
  const [pending, startTransition] = useTransition();

  const { data, isLoading } = useQuery({
    queryKey: ["keywords", brandId],
    queryFn: () => fetchKeywords(brandId),
  });

  const refresh = () =>
    qc.invalidateQueries({ queryKey: ["keywords", brandId] });

  function handleAdd() {
    if (!term.trim()) return;
    startTransition(async () => {
      const res = await addKeyword({ brandId, term });
      if (!res.ok) toast.error(res.error);
      else {
        toast.success("Keyword added.");
        setTerm("");
        refresh();
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Keywords</CardTitle>
        <CardDescription>
          Tracked terms feed weekly research and keyword findings.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            handleAdd();
          }}
        >
          <label className="sr-only" htmlFor="kw-term">
            Add keyword
          </label>
          <Input
            id="kw-term"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="e.g. youth strength training"
            maxLength={80}
          />
          <Button type="submit" disabled={!term.trim() || pending}>
            <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            Add
          </Button>
        </form>

        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : (data ?? []).length === 0 ? (
          <EmptyState
            title="No keywords yet"
            description="Add terms to track in weekly research."
          />
        ) : (
          <ul className="divide-y" role="list">
            {(data ?? []).map((k) => (
              <li
                key={k.id}
                className="flex items-center justify-between gap-2 py-2 text-sm"
              >
                <div className="min-w-0">
                  <span className="font-medium">{k.term}</span>
                  <Badge
                    variant={k.status === "active" ? "default" : "secondary"}
                    className="ml-2 text-xs"
                  >
                    {k.status}
                  </Badge>
                  {k.lastPulledAt && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      pulled {new Date(k.lastPulledAt).toLocaleDateString()}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      startTransition(async () => {
                        const res = await pullKeywordNow({
                          brandId,
                          keywordId: k.id,
                        });
                        if (!res.ok) toast.error(res.error);
                        else toast.success("Pull queued.");
                      })
                    }
                    aria-label={`Pull keyword ${k.term} now`}
                  >
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      startTransition(async () => {
                        const res = await setKeywordStatus({
                          brandId,
                          keywordId: k.id,
                          status: k.status === "active" ? "paused" : "active",
                        });
                        if (!res.ok) toast.error(res.error);
                        else refresh();
                      })
                    }
                    aria-label={
                      k.status === "active"
                        ? `Pause ${k.term}`
                        : `Resume ${k.term}`
                    }
                  >
                    {k.status === "active" ? (
                      <Pause className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : (
                      <Play className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      startTransition(async () => {
                        const res = await deleteKeyword({
                          brandId,
                          keywordId: k.id,
                        });
                        if (!res.ok) toast.error(res.error);
                        else {
                          toast.success("Keyword removed.");
                          refresh();
                        }
                      })
                    }
                    aria-label={`Delete ${k.term}`}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-destructive" aria-hidden="true" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
