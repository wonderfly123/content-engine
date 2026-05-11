import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { cadenceSettings, channelConnections } from "@/lib/db/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DoneActions } from "./8-actions";
import type { Brand } from "../page";

interface Step8Props {
  brand: Brand;
}

export async function Step8Done({ brand }: Step8Props) {
  const [channels, cadence] = await Promise.all([
    db
      .select({ channel: channelConnections.channel })
      .from(channelConnections)
      .where(eq(channelConnections.brandId, brand.id)),
    db
      .select({
        channel: cadenceSettings.channel,
        format: cadenceSettings.format,
        perWeek: cadenceSettings.perWeek,
      })
      .from(cadenceSettings)
      .where(eq(cadenceSettings.brandId, brand.id)),
  ]);

  const totalPerWeek = cadence.reduce((sum, r) => sum + r.perWeek, 0);

  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-xl font-semibold">All set</h2>
        <p className="text-sm text-muted-foreground">
          Your brand workspace is ready. You can revisit any of these in
          Settings.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{brand.name}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Channels connected</span>
            <span className="font-medium">{channels.length}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Posts per week</span>
            <span className="font-medium">{totalPerWeek}</span>
          </div>
          {cadence.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
              {cadence.map((r) => (
                <li key={`${r.channel}-${r.format}`} className="flex justify-between">
                  <span className="capitalize">
                    {r.channel} {r.format}
                  </span>
                  <span>{r.perWeek}/wk</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <DoneActions brandId={brand.id} />
    </div>
  );
}
