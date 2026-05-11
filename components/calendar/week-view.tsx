"use client";

import { addDays, format, isSameDay, startOfWeek } from "date-fns";
import { useMemo, useState } from "react";
import { isOptimalSlot, type OptimalSlot } from "@/lib/calendar/optimal-times";
import { OptimalTimeBadge } from "./optimal-time-badge";
import { PostTile, type CalendarPost } from "./post-tile";
import { cn } from "@/lib/utils";

interface WeekViewProps {
  date: Date;
  posts: CalendarPost[];
  optimalSlots?: OptimalSlot[];
  onReschedule?: (postId: string, newScheduledFor: Date) => void;
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const WEEKDAYS = Array.from({ length: 7 }, (_, i) => i);

export function WeekView({
  date,
  posts,
  optimalSlots = [],
  onReschedule,
}: WeekViewProps) {
  const weekStart = useMemo(
    () => startOfWeek(date, { weekStartsOn: 0 }),
    [date],
  );
  const days = useMemo(
    () => WEEKDAYS.map((i) => addDays(weekStart, i)),
    [weekStart],
  );
  const [dragOver, setDragOver] = useState<string | null>(null);

  // Index posts by (dayKey:hour) → CalendarPost[].
  const byCell = useMemo(() => {
    const m = new Map<string, CalendarPost[]>();
    posts.forEach((p) => {
      const d = new Date(p.scheduledFor);
      const key = `${format(d, "yyyy-MM-dd")}:${d.getHours()}`;
      const arr = m.get(key) ?? [];
      arr.push(p);
      m.set(key, arr);
    });
    return m;
  }, [posts]);

  function handleDragStart(e: React.DragEvent, postId: string) {
    e.dataTransfer.setData("text/post-id", postId);
    e.dataTransfer.effectAllowed = "move";
  }

  function handleDrop(e: React.DragEvent, day: Date, hour: number) {
    e.preventDefault();
    const postId = e.dataTransfer.getData("text/post-id");
    if (!postId || !onReschedule) return;
    const target = new Date(day);
    target.setHours(hour, 0, 0, 0);
    onReschedule(postId, target);
    setDragOver(null);
  }

  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <div className="grid min-w-[800px] grid-cols-[60px_repeat(7,1fr)]">
        <div className="border-b border-r bg-muted/40" />
        {days.map((d) => {
          const isToday = isSameDay(d, new Date());
          return (
            <div
              key={d.toISOString()}
              className={cn(
                "border-b border-r px-2 py-1.5 text-xs font-medium",
                isToday && "bg-primary/5",
              )}
            >
              <div>{format(d, "EEE")}</div>
              <div className="text-muted-foreground">{format(d, "MMM d")}</div>
            </div>
          );
        })}

        {HOURS.map((hour) => (
          <div key={`row-${hour}`} className="contents">
            <div className="border-b border-r px-1.5 py-1 text-[10px] text-muted-foreground tabular-nums">
              {hour.toString().padStart(2, "0")}:00
            </div>
            {days.map((day) => {
              const key = `${format(day, "yyyy-MM-dd")}:${hour}`;
              const cellPosts = byCell.get(key) ?? [];
              const slotDate = new Date(day);
              slotDate.setHours(hour, 0, 0, 0);
              const isOptimal =
                optimalSlots.length > 0 && isOptimalSlot(slotDate, optimalSlots);
              const dropTarget = dragOver === key;
              return (
                <div
                  key={key}
                  className={cn(
                    "relative min-h-[36px] border-b border-r px-0.5 py-0.5",
                    dropTarget && "bg-accent/60",
                  )}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(key);
                  }}
                  onDragLeave={() => setDragOver(null)}
                  onDrop={(e) => handleDrop(e, day, hour)}
                >
                  {isOptimal && (
                    <div className="absolute right-1 top-0.5">
                      <OptimalTimeBadge />
                    </div>
                  )}
                  <div className="flex flex-col gap-0.5">
                    {cellPosts.map((p) => (
                      <PostTile
                        key={p.id}
                        post={p}
                        compact
                        draggable={p.status === "queued"}
                        onDragStart={handleDragStart}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
