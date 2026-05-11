import { BriefQueue } from "@/components/briefs/brief-queue";
import { DraftList } from "@/components/drafts/draft-list";
import { Separator } from "@/components/ui/separator";

export default function InstagramPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Instagram</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Full pipeline for Instagram — briefs and drafts filtered to this
          channel.
        </p>
      </div>
      <section aria-label="Instagram briefs">
        <BriefQueue channel="instagram" />
      </section>
      <Separator />
      <section aria-label="Instagram drafts">
        <DraftList channel="instagram" />
      </section>
    </div>
  );
}
