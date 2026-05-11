"use client";

import {
  addDays,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { useMemo, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { isOptimalSlot, type OptimalSlot } from "@/lib/calendar/optimal-times";
import { OptimalTimeBadge } from "./optimal-time-badge";
import { PostTile, type CalendarPost } from "./post-tile";

interface MonthViewProps {
  date: Date;
  posts: CalendarPost[];
  optimalSlots?: OptimalSlot[];
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function MonthView({ date, posts, optimalSlots = [] }: MonthViewProps) {
  const [sheetDate, setSheetDate] = useState<Date | null>(null);

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(date), { weekStartsOn: 0 });
    const end = endOfWeek(endOfMonth(date), { weekStartsOn: 0 });
    const arr: Date[] = [];
    for (let d = start; d <= end; d = addDays(d, 1)) arr.push(d);
    return arr;
  }, [date]);

  const byDay = useMemo(() => {
    const m = new Map<string, CalendarPost[]>();
    posts.forEach((p) => {
      const key = format(new Date(p.scheduledFor), "yyyy-MM-dd");
      const arr = m.get(key) ?? [];
      arr.push(p);
      m.set(key, arr);
    });
    return m;
  }, [posts]);

  const sheetPosts = sheetDate
    ? byDay.get(format(sheetDate, "yyyy-MM-dd")) ?? []
    : [];

  return (
    <div className="rounded-lg border bg-card">
      <div className="grid grid-cols-7 border-b text-xs font-medium text-muted-foreground">
        {WEEKDAY_LABELS.map((d) => (
          <div key={d} className="px-2 py-1.5">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 grid-rows-6">
        {days.map((d) => {
          const key = format(d, "yyyy-MM-dd");
          const dayPosts = byDay.get(key) ?? [];
          const visible = dayPosts.slice(0, 4);
          const overflow = dayPosts.length - visible.length;
          const inMonth = isSameMonth(d, date);
          const isToday = isSameDay(d, new Date());
          const hasOptimal =
            optimalSlots.length > 0 && isOptimalSlot(d, optimalSlots);
          return (
            <button
              key={key}
              type="button"
              onClick={() => setSheetDate(d)}
              className={cn(
                "flex min-h-[88px] flex-col items-stretch gap-1 border-b border-r px-1.5 py-1 text-left transition-colors hover:bg-accent/40",
                !inMonth && "bg-muted/40 text-muted-foreground",
              )}
              aria-label={`Open ${format(d, "PPP")}`}
            >
              <div className="flex items-center justify-between text-[11px]">
                <span
                  className={cn(
                    "tabular-nums",
                    isToday &&
                      "inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground",
                  )}
                >
                  {format(d, "d")}
                </span>
                {hasOptimal && <OptimalTimeBadge />}
              </div>
              <div className="flex flex-col gap-0.5">
                {visible.map((p) => (
                  <PostTile key={p.id} post={p} compact />
                ))}
                {overflow > 0 && (
                  <span className="text-[10px] text-muted-foreground">
                    +{overflow} more
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      <Sheet open={sheetDate !== null} onOpenChange={(o) => !o && setSheetDate(null)}>
        <SheetContent side="right" className="w-[400px] sm:max-w-md">
          <SheetHeader>
            <SheetTitle>
              {sheetDate ? format(sheetDate, "EEEE, MMM d") : ""}
            </SheetTitle>
            <SheetDescription>
              {sheetPosts.length} post{sheetPosts.length === 1 ? "" : "s"}{" "}
              {sheetPosts.length === 0 ? "scheduled for this day." : ""}
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-2 px-4">
            {sheetPosts.map((p) => (
              <PostTile key={p.id} post={p} />
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
