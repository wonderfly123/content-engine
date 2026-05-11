"use client";

import { addMonths, addWeeks, format } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type CalendarView = "month" | "week";

export function CalendarToolbar({
  view,
  date,
  onViewChange,
  onDateChange,
}: {
  view: CalendarView;
  date: Date;
  onViewChange: (v: CalendarView) => void;
  onDateChange: (d: Date) => void;
}) {
  const stepBack = () =>
    onDateChange(view === "month" ? addMonths(date, -1) : addWeeks(date, -1));
  const stepFwd = () =>
    onDateChange(view === "month" ? addMonths(date, 1) : addWeeks(date, 1));
  const today = () => onDateChange(new Date());
  const label =
    view === "month" ? format(date, "MMMM yyyy") : `Week of ${format(date, "MMM d, yyyy")}`;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={stepBack} aria-label="Previous">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="sm" onClick={today}>
          Today
        </Button>
        <Button variant="outline" size="sm" onClick={stepFwd} aria-label="Next">
          <ChevronRight className="h-4 w-4" />
        </Button>
        <span className="ml-2 text-sm font-medium">{label}</span>
      </div>
      <Tabs value={view} onValueChange={(v) => onViewChange(v as CalendarView)}>
        <TabsList>
          <TabsTrigger value="month">Month</TabsTrigger>
          <TabsTrigger value="week">Week</TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
  );
}
