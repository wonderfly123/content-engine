"use client";

import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface Comment {
  id: string;
  username: string;
  text: string;
  at: string;
}

const POLL_MS = 60_000;

export function LiveComments({ postId }: { postId: string }) {
  const [comments, setComments] = useState<Comment[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = () =>
      fetch(`/api/comments/${postId}`)
        .then((r) => r.json())
        .then((j: { data: { comments: Comment[] } | null }) => {
          if (!cancelled) setComments(j.data?.comments ?? []);
        })
        .catch(() => !cancelled && setComments([]));
    tick();
    const t = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [postId]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Live comments</CardTitle>
        <CardDescription>Polled from Meta Graph.</CardDescription>
      </CardHeader>
      <CardContent>
        {comments === null ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : comments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No comments yet.</p>
        ) : (
          <ul className="space-y-2">
            {comments.slice(0, 20).map((c) => (
              <li key={c.id} className="text-sm">
                <span className="font-medium">@{c.username}</span>{" "}
                <span className="text-muted-foreground">
                  {new Date(c.at).toLocaleString()}
                </span>
                <div>{c.text}</div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
