import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function AnalyticsPage() {
  const topCards = [
    "Total reach",
    "Engagement rate",
    "Follower delta",
    "Posts published",
    "Avg reach / post",
    "Top format",
  ];
  const callouts = ["What's working", "Patterns to avoid"];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Analytics</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Unified live view with filters; click any row to drill into provenance.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-md border bg-card p-3">
        <span className="text-xs text-muted-foreground">Filters:</span>
        <Button variant="outline" size="sm" disabled>Channel</Button>
        <Button variant="outline" size="sm" disabled>Format</Button>
        <Button variant="outline" size="sm" disabled>ICP</Button>
        <Button variant="outline" size="sm" disabled>Date range</Button>
        <div className="ml-auto text-xs text-muted-foreground">Last synced: —</div>
      </div>

      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
        {topCards.map((label) => (
          <Card key={label}>
            <CardHeader className="pb-2">
              <CardDescription className="text-xs">{label}</CardDescription>
              <CardTitle className="text-2xl tabular-nums">—</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {["Reach over time", "Engagement rate", "Follower growth"].map((label) => (
          <Card key={label}>
            <CardHeader>
              <CardTitle className="text-base">{label}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-32 rounded-md border border-dashed border-border/60" />
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {callouts.map((label) => (
          <Card key={label}>
            <CardHeader>
              <CardTitle className="text-base">{label}</CardTitle>
              <CardDescription>Computed nightly by pattern recompute.</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">Not enough data yet.</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Posts</CardTitle>
          <CardDescription>
            Sortable post table arrives in Task 11. Click a row to view the provenance trail.
          </CardDescription>
        </CardHeader>
        <CardContent />
      </Card>
    </div>
  );
}
