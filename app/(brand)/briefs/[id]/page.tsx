import { notFound } from "next/navigation";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { briefs } from "@/lib/db/schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function BriefDetailPage({ params }: PageProps) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [brief] = await db.select().from(briefs).where(eq(briefs.id, id));
  if (!brief) notFound();

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Button asChild variant="ghost" size="sm">
        <Link href="/briefs">← Back to briefs</Link>
      </Button>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>{brief.title}</CardTitle>
            <div className="flex gap-1">
              <Badge variant="secondary" className="capitalize">
                {brief.channel}
              </Badge>
              <Badge variant="outline" className="capitalize">
                {brief.format}
              </Badge>
              <Badge>{brief.status}</Badge>
            </div>
          </div>
          {brief.hook && <CardDescription>{brief.hook}</CardDescription>}
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {brief.angle && (
            <p>
              <span className="font-medium">Angle: </span>
              <span className="text-muted-foreground">{brief.angle}</span>
            </p>
          )}
          {brief.keyMessage && (
            <p>
              <span className="font-medium">Key message: </span>
              <span className="text-muted-foreground">{brief.keyMessage}</span>
            </p>
          )}
          {brief.suggestedCta && (
            <p>
              <span className="font-medium">CTA: </span>
              <span className="text-muted-foreground">{brief.suggestedCta}</span>
            </p>
          )}
          {brief.targetPublishDate && (
            <p>
              <span className="font-medium">Target publish: </span>
              <span className="text-muted-foreground">
                {brief.targetPublishDate}
              </span>
            </p>
          )}
          {brief.suggestedHashtags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {brief.suggestedHashtags.map((h) => (
                <Badge key={h} variant="outline">
                  #{h}
                </Badge>
              ))}
            </div>
          )}
          {brief.rejectionReason && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
              Rejected: {brief.rejectionReason}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
