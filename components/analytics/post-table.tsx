"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

export interface AnalyticsPostRow {
  postId: string;
  channel: string;
  format: string;
  title: string;
  publishedAt: string | null;
  thumbnailUrl: string | null;
  reach: number | null;
  views: number | null;
  likes: number | null;
  engagementRate: number;
  saves: number | null;
  followsFromPost: number | null;
}

type SortKey = keyof Pick<
  AnalyticsPostRow,
  | "publishedAt"
  | "reach"
  | "views"
  | "likes"
  | "engagementRate"
  | "saves"
  | "followsFromPost"
  | "title"
>;

export function PostTable({
  rows,
  loading,
}: {
  rows: AnalyticsPostRow[];
  loading?: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sortKey = (searchParams.get("sort") ?? "publishedAt") as SortKey;
  const sortDir = (searchParams.get("dir") ?? "desc") as "asc" | "desc";

  const sorted = useMemo(() => {
    const out = [...rows];
    out.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return out;
  }, [rows, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    const sp = new URLSearchParams(searchParams.toString());
    if (sortKey === key) {
      sp.set("dir", sortDir === "asc" ? "desc" : "asc");
    } else {
      sp.set("sort", key);
      sp.set("dir", "desc");
    }
    router.replace(`/analytics?${sp.toString()}`);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Posts</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[44px]"></TableHead>
              <TableHead className="w-[80px]">Channel</TableHead>
              <TableHead className="w-[80px]">Format</TableHead>
              <SortableHead k="title" current={sortKey} dir={sortDir} onClick={toggleSort}>
                Title
              </SortableHead>
              <SortableHead k="publishedAt" current={sortKey} dir={sortDir} onClick={toggleSort}>
                Published
              </SortableHead>
              <SortableHead k="reach" current={sortKey} dir={sortDir} onClick={toggleSort}>
                Reach
              </SortableHead>
              <SortableHead k="views" current={sortKey} dir={sortDir} onClick={toggleSort}>
                Views
              </SortableHead>
              <SortableHead k="likes" current={sortKey} dir={sortDir} onClick={toggleSort}>
                Likes
              </SortableHead>
              <SortableHead k="engagementRate" current={sortKey} dir={sortDir} onClick={toggleSort}>
                ER
              </SortableHead>
              <SortableHead k="saves" current={sortKey} dir={sortDir} onClick={toggleSort}>
                Saves
              </SortableHead>
              <SortableHead k="followsFromPost" current={sortKey} dir={sortDir} onClick={toggleSort}>
                Follows Δ
              </SortableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 11 }).map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : sorted.length === 0 ? (
              <TableRow>
                <TableCell colSpan={11} className="text-center text-sm text-muted-foreground">
                  No posts in this window.
                </TableCell>
              </TableRow>
            ) : (
              sorted.map((r) => (
                <TableRow
                  key={r.postId}
                  className="cursor-pointer"
                  onClick={() => router.push(`/analytics/post/${r.postId}`)}
                >
                  <TableCell>
                    {r.thumbnailUrl ? (
                      <Image
                        src={r.thumbnailUrl}
                        alt=""
                        width={36}
                        height={36}
                        unoptimized
                        className="h-9 w-9 rounded object-cover"
                      />
                    ) : (
                      <div className="h-9 w-9 rounded bg-muted" />
                    )}
                  </TableCell>
                  <TableCell className="capitalize">{r.channel}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="capitalize">
                      {r.format}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-[280px] truncate">
                    <Link
                      href={`/analytics/post/${r.postId}`}
                      className="hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {r.title}
                    </Link>
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {r.publishedAt
                      ? new Date(r.publishedAt).toLocaleDateString()
                      : "—"}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {(r.reach ?? 0).toLocaleString()}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {(r.views ?? 0).toLocaleString()}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {(r.likes ?? 0).toLocaleString()}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {(r.engagementRate * 100).toFixed(1)}%
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {(r.saves ?? 0).toLocaleString()}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {(r.followsFromPost ?? 0).toLocaleString()}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function SortableHead({
  k,
  current,
  dir,
  onClick,
  children,
}: {
  k: SortKey;
  current: SortKey;
  dir: "asc" | "desc";
  onClick: (k: SortKey) => void;
  children: React.ReactNode;
}) {
  const active = current === k;
  const Icon = !active ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <TableHead>
      <button
        type="button"
        className="-ml-1 inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-accent"
        onClick={() => onClick(k)}
      >
        {children}
        <Icon className="h-3 w-3" />
      </button>
    </TableHead>
  );
}
