"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { endOfMonth, endOfWeek, startOfMonth, startOfWeek } from "date-fns";
import { toast } from "sonner";
import { CalendarToolbar, type CalendarView } from "@/components/calendar/calendar-toolbar";
import { MonthView } from "@/components/calendar/month-view";
import { WeekView } from "@/components/calendar/week-view";
import type { CalendarPost } from "@/components/calendar/post-tile";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useBrandStore } from "@/lib/stores/brand-store";
import { getOptimalTimes, type OptimalSlot } from "@/lib/calendar/optimal-times";

export default function CalendarPage() {
  const brand = useBrandStore((s) => s.active);
  const router = useRouter();
  const searchParams = useSearchParams();

  const view: CalendarView =
    (searchParams.get("view") as CalendarView) === "week" ? "week" : "month";
  const dateParam = searchParams.get("date");
  const date = useMemo(
    () => (dateParam ? new Date(dateParam) : new Date()),
    [dateParam],
  );

  const [posts, setPosts] = useState<CalendarPost[]>([]);
  const [optimalSlots, setOptimalSlots] = useState<OptimalSlot[]>([]);
  const [loading, setLoading] = useState(false);

  // Update URL params when toolbar changes view / date.
  const updateParams = useCallback(
    (next: { view?: CalendarView; date?: Date }) => {
      const sp = new URLSearchParams(searchParams.toString());
      if (next.view) sp.set("view", next.view);
      if (next.date) sp.set("date", next.date.toISOString().slice(0, 10));
      router.replace(`/calendar?${sp.toString()}`);
    },
    [router, searchParams],
  );

  // Date range to fetch: a generous wrapper around the visible window.
  const range = useMemo(() => {
    if (view === "week") {
      return {
        from: startOfWeek(date, { weekStartsOn: 0 }),
        to: endOfWeek(date, { weekStartsOn: 0 }),
      };
    }
    return {
      from: startOfWeek(startOfMonth(date), { weekStartsOn: 0 }),
      to: endOfWeek(endOfMonth(date), { weekStartsOn: 0 }),
    };
  }, [view, date]);

  useEffect(() => {
    if (!brand) return;
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({
      brandId: brand.id,
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      status: "queued,published,publishing,failed",
    });
    fetch(`/api/posts?${params.toString()}`)
      .then((r) => r.json())
      .then((j: { data: { posts: CalendarPost[] } | null }) => {
        if (cancelled) return;
        setPosts(j.data?.posts ?? []);
      })
      .catch(() => !cancelled && setPosts([]))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [brand, range.from, range.to]);

  // For now use category-default optimal slots; the page will pick up the
  // heatmap once Pipeline 6 writes it. We compute on first render only.
  useEffect(() => {
    setOptimalSlots(
      getOptimalTimes({
        heatmap: null, // brand.settings_json.patterns.time_heatmap when wired
        channel: "instagram",
        format: "reel",
      }),
    );
  }, [brand]);

  const handleReschedule = useCallback(
    async (postId: string, when: Date) => {
      const res = await fetch(`/api/posts/${postId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scheduledFor: when.toISOString() }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        toast.error(j?.error?.message ?? "Could not reschedule");
        return;
      }
      // Optimistically update local state.
      setPosts((prev) =>
        prev.map((p) =>
          p.id === postId ? { ...p, scheduledFor: when.toISOString() } : p,
        ),
      );
      toast.success("Rescheduled");
    },
    [],
  );

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Calendar</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {loading ? "Loading…" : `${posts.length} posts in view`}
        </p>
      </div>

      <CalendarToolbar
        view={view}
        date={date}
        onViewChange={(v) => updateParams({ view: v })}
        onDateChange={(d) => updateParams({ date: d })}
      />

      {!brand ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">No active brand</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Pick a brand in the sidebar switcher to view its calendar.
            </p>
          </CardContent>
        </Card>
      ) : view === "month" ? (
        <MonthView date={date} posts={posts} optimalSlots={optimalSlots} />
      ) : (
        <WeekView
          date={date}
          posts={posts}
          optimalSlots={optimalSlots}
          onReschedule={handleReschedule}
        />
      )}
    </div>
  );
}
