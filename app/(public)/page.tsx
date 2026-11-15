import Link from "next/link";
import { redirect } from "next/navigation";
import { MessageSquare, Scissors, Send, Upload } from "lucide-react";
import { getAccess } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { SITE } from "@/lib/site";

export const dynamic = "force-dynamic";
export const metadata = {
  title: `${SITE.productName}: raw clips to finished reels`,
  description: "Upload raw phone footage, get finished vertical reels back to review, and schedule them to Instagram. Request changes by text or in the app.",
};

const STEPS = [
  { icon: Upload, title: "Upload your clips", body: "Drop raw phone footage into the app, straight from your camera roll." },
  { icon: Scissors, title: "Get edited cuts back", body: "The editor cuts vertical reels and stories, with opening text and captions, for you to review." },
  { icon: MessageSquare, title: "Ask for changes", body: "Trim it, reorder it, or describe what you want, in the app or by text message." },
  { icon: Send, title: "Approve and schedule", body: "Nothing posts until you approve it. Approved videos go out to Instagram at the time you pick." },
];

export default async function LandingPage() {
  // Signed-in people go straight to the app.
  const access = await getAccess().catch(() => null);
  if (access?.status === "active") redirect("/calendar");

  return (
    <>
      <section className="mx-auto max-w-5xl px-4 pb-12 pt-16 sm:px-6 sm:pt-24">
        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">Raw clips in. Finished reels out.</h1>
        <p className="mt-5 max-w-2xl text-lg text-muted-foreground">
          {SITE.productName} turns the footage on your phone into vertical videos for Instagram, and keeps every
          request, preview and approval in one place.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link href="/login">Create an account</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/login">Sign in</Link>
          </Button>
        </div>
      </section>

      <section className="border-t bg-muted/30">
        <div className="mx-auto grid max-w-5xl gap-8 px-4 py-14 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
          {STEPS.map(({ icon: Icon, title, body }) => (
            <div key={title}>
              <Icon className="h-5 w-5" aria-hidden="true" />
              <h2 className="mt-3 font-semibold">{title}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 py-14 sm:px-6">
        <h2 className="text-2xl font-semibold tracking-tight">Text the editor</h2>
        <div className="mt-4 max-w-3xl space-y-4 text-muted-foreground">
          <p>
            Account holders can turn on text messages from {SITE.textingProgram}: text &ldquo;new reel&rdquo; or
            &ldquo;new story&rdquo; to start a video, ask for changes, and get links to previews and confirmations
            when a post goes out. The whole conversation is saved to your account, so you can pick it up in the app.
          </p>
          <p>
            <span className="font-medium text-foreground">How to sign up:</span> after signing in, open Settings, enter
            your mobile number, tick the box agreeing to receive texts, and enter the code we text you. Texting is
            optional and is not required to use {SITE.productName}.
          </p>
          <p className="text-sm">
            Message frequency varies with your activity. Message and data rates may apply. Reply STOP to cancel, HELP
            for help. See the <Link href="/texting" className="underline underline-offset-4">texting terms</Link> and{" "}
            <Link href="/privacy" className="underline underline-offset-4">privacy policy</Link>.
          </p>
        </div>
      </section>
    </>
  );
}
