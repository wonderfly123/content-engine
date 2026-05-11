import { BriefQueue } from "@/components/briefs/brief-queue";
import { DraftList } from "@/components/drafts/draft-list";
import { Separator } from "@/components/ui/separator";

export default function FacebookPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Facebook</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Full pipeline for Facebook — briefs and drafts filtered to this
          channel.
        </p>
      </div>
      <section aria-label="Facebook briefs">
        <BriefQueue channel="facebook" />
      </section>
      <Separator />
      <section aria-label="Facebook drafts">
        <DraftList channel="facebook" />
      </section>
    </div>
  );
}
