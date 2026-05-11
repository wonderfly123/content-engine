import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function DashboardPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Dashboard</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Today&apos;s queue, this week&apos;s calendar preview, and system alerts.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Today&apos;s queue</CardTitle>
            <CardDescription>Posts scheduled to publish today</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">No posts queued.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">This week</CardTitle>
            <CardDescription>Calendar preview for the next 7 days</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Nothing scheduled.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Alerts</CardTitle>
            <CardDescription>Failed publishes, expired tokens, stale research</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">All systems healthy.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
