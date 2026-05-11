import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function CalendarPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Calendar</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Month and week views; drag-to-reschedule.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled>
            Month
          </Button>
          <Button variant="outline" size="sm" disabled>
            Week
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Nothing scheduled yet</CardTitle>
          <CardDescription>
            Calendar grid arrives in Task 10. Tiles will show status icons, format badges, time, and
            channel color bands.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-7 gap-2">
          {Array.from({ length: 28 }).map((_, i) => (
            <div
              key={i}
              className="aspect-square rounded-md border border-dashed border-border/60"
              aria-hidden="true"
            />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
