import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function HomePage() {
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Home</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Cross-brand totals across every brand you operate.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {["Total brands", "Posts this week", "Pending briefs", "Open alerts"].map((label) => (
          <Card key={label}>
            <CardHeader>
              <CardDescription>{label}</CardDescription>
              <CardTitle className="text-3xl tabular-nums">—</CardTitle>
            </CardHeader>
            <CardContent />
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Coming soon</CardTitle>
          <CardDescription>
            Cross-brand rollups arrive once Task 5 wires real brand data.
          </CardDescription>
        </CardHeader>
        <CardContent />
      </Card>
    </div>
  );
}
