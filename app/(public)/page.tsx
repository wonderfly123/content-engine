import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, BarChart3, ChevronDown, Layers, MessageSquare, Mic, Scissors, ShieldCheck, Sparkles } from "lucide-react";
import { getAccess } from "@/lib/auth/session";
import { SITE } from "@/lib/site";

export const dynamic = "force-dynamic";
export const metadata = {
  title: `${SITE.productName}: raw clips in, finished reels out`,
  description:
    "Upload raw phone footage and get finished vertical reels and stories back to review. Ask for changes by text or in the app. Nothing posts until you approve it.",
};

const APP = `https://${SITE.appHost}`;
const GRADIENT_TEXT = "bg-gradient-to-br from-amber-500 to-orange-600 bg-clip-text text-transparent";
const CTA =
  "inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 px-6 py-3 font-semibold text-white shadow-lg shadow-orange-500/25 transition-all hover:from-amber-600 hover:to-orange-600";

const STEPS = [
  { n: "01", title: "Drop in your clips", body: "Upload raw footage from your phone, straight from the camera roll. No trimming first." },
  { n: "02", title: "The editor cuts it", body: "Vertical reels and stories, clean cuts, opening text and a caption in your brand's voice." },
  { n: "03", title: "Ask for changes", body: "“Shorter.” “Open on the pour.” Say it by text or in the app, or trim it yourself." },
  { n: "04", title: "Approve and schedule", body: "Pick a time and it posts to Instagram. Nothing goes out until you say yes." },
];

const FEATURES = [
  { icon: MessageSquare, title: "One thread per video", body: "Every request, preview and approval in one conversation, whether it started by text or in the app." },
  { icon: Scissors, title: "Cut from your footage", body: "1080x1920 vertical edits with clean cuts, built from the strongest moments in what you shot." },
  { icon: Layers, title: "Hand edits when you want them", body: "Trim, reorder, split or drop any shot, and pick the cover frame, right in the browser." },
  { icon: Mic, title: "Voice-over and captions", body: "Record a voice-over over the cut in your browser. Captions are timed and burned in for you." },
  { icon: ShieldCheck, title: "You approve everything", body: "Scheduled posts go out at the time you choose, and only after you approve the final video." },
  { icon: BarChart3, title: "See what works", body: "Follower growth, views and engagement for every post, across every brand you run." },
];

const FAQS = [
  { q: "What is Nekter?", a: "An AI video editor for people who post. You upload raw clips from your phone; Nekter cuts them into vertical reels and stories with opening text and captions, then schedules them to Instagram once you approve." },
  { q: "Do I need editing skills?", a: "No. You review a finished cut and say what to change. If you like doing it yourself, the clip editor lets you trim and reorder every shot." },
  { q: "How do I send my footage?", a: "Upload it in the app from your phone or computer. Text messages can't carry full-quality video, so texts link you to the upload page for that video." },
  { q: "Will anything post without me?", a: "Never. A video is only scheduled after you approve the final cut, the caption and the time." },
  { q: "Can I run more than one brand?", a: "Yes. Each brand keeps its own voice, connected Instagram account and calendar, all under one sign-in." },
  { q: "Can I text it?", a: "Yes, if you turn texting on in Settings. Text “new reel” or “new story” to start, reply with changes, and reply “yes” to approve. Message frequency varies and message and data rates may apply; reply STOP to cancel or HELP for help." },
];

/** The hero visual: a text thread beside a reel preview, inside a browser frame. */
function ProductPreview() {
  const thread = [
    { me: true, text: "new reel" },
    { me: false, text: "On it. Upload the clips here: app.nekter.io/chats/…" },
    { me: true, text: "make it shorter and open on the pour" },
    { me: false, text: "Done. New 15s cut is ready to review." },
    { me: true, text: "yes" },
    { me: false, text: "Scheduled for Friday at 9:00 AM." },
  ];
  return (
    <div className="relative mt-16">
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl shadow-gray-200/50">
        <div className="flex items-center gap-2 border-b border-gray-100 bg-gray-50/50 px-4 py-3">
          <div className="flex gap-1.5">
            <span className="h-3 w-3 rounded-full bg-red-400" />
            <span className="h-3 w-3 rounded-full bg-yellow-400" />
            <span className="h-3 w-3 rounded-full bg-green-400" />
          </div>
          <span className="flex-1 text-center text-xs text-gray-400">{SITE.appHost}</span>
        </div>
        <div className="grid gap-6 p-6 md:grid-cols-[1fr_auto] md:p-10">
          <div className="flex flex-col gap-3" aria-label="Example conversation">
            {thread.map((m, i) => (
              <div key={i} className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${m.me ? "self-end bg-gradient-to-r from-amber-500 to-orange-500 text-white" : "self-start bg-gray-100 text-gray-800"}`}>
                {m.text}
              </div>
            ))}
          </div>
          <div className="mx-auto w-44 md:w-52" aria-label="Example reel preview">
            <div className="relative aspect-[9/16] overflow-hidden rounded-2xl bg-gradient-to-br from-amber-200 via-orange-300 to-rose-400 shadow-lg">
              <div className="absolute inset-x-3 top-5 rounded-lg bg-black/55 px-3 py-2 text-center text-xs font-semibold text-white">Day 1 vs day 30</div>
              <div className="absolute inset-x-3 bottom-4 space-y-1.5">
                <div className="flex gap-1">
                  {[30, 18, 24, 12, 16].map((w, i) => (
                    <span key={i} className="h-6 rounded bg-white/70" style={{ width: `${w}%` }} />
                  ))}
                </div>
                <div className="text-center text-[10px] font-medium text-white/90">15s · ready to review</div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <p className="mx-auto mt-6 max-w-2xl text-center text-sm text-gray-500">
        {SITE.productName} is an AI video editor that turns raw phone footage into vertical reels and stories, keeps every request
        and approval in one thread, and schedules approved videos to Instagram.
      </p>
      <div className="absolute -left-20 -top-20 -z-10 h-64 w-64 rounded-full bg-amber-200/30 blur-3xl" />
      <div className="absolute -bottom-20 -right-20 -z-10 h-64 w-64 rounded-full bg-orange-200/30 blur-3xl" />
    </div>
  );
}

export default async function LandingPage() {
  // Signed-in people go straight to the app.
  const access = await getAccess().catch(() => null);
  if (access?.status === "active") redirect("/dashboard");

  return (
    <>
      <section className="overflow-hidden px-4 pb-20 pt-32 sm:px-6">
        <div className="mx-auto max-w-6xl">
          <div className="mx-auto max-w-4xl text-center">
            <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-4 py-2 shadow-sm">
              <Sparkles className="h-4 w-4 text-amber-500" aria-hidden="true" />
              <span className="text-sm font-medium text-gray-600">Text your editor. Get a finished reel.</span>
            </div>
            <h1 className="mb-6 text-5xl font-bold leading-tight text-gray-900 md:text-6xl lg:text-7xl">
              Raw clips in.
              <br />
              <span className={GRADIENT_TEXT}>Finished reels out.</span>
            </h1>
            <p className="mx-auto mb-6 max-w-2xl text-xl leading-relaxed text-gray-600">
              Shooting is the easy part. Turning every clip into something worth posting is where content stalls. {SITE.productName} edits
              your phone footage into reels and stories, writes the opening text and caption, and waits for your yes.
            </p>
            <p className="mb-10 text-2xl font-semibold text-gray-900">Post every week without opening an editor.</p>
            <div className="flex flex-wrap justify-center gap-3">
              <a href={`${APP}/login`} className={CTA}>
                Get started
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </a>
              <a href="#how" className="inline-flex items-center rounded-lg border border-gray-200 bg-white px-6 py-3 font-semibold text-gray-900 shadow-sm transition-colors hover:bg-gray-50">
                See how it works
              </a>
            </div>
          </div>
          <ProductPreview />
        </div>
      </section>

      <section id="how" className="scroll-mt-20 bg-gray-900 px-4 py-24 sm:px-6">
        <div className="mx-auto max-w-6xl">
          <h2 className="mb-16 text-center text-3xl font-bold text-white md:text-4xl">From camera roll to calendar in four steps.</h2>
          <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s) => (
              <div key={s.n}>
                <div className="mb-4 bg-gradient-to-r from-amber-400 to-orange-500 bg-clip-text text-5xl font-bold text-transparent">{s.n}</div>
                <h3 className="mb-2 text-lg font-semibold text-white">{s.title}</h3>
                <p className="leading-relaxed text-gray-400">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="features" className="scroll-mt-20 px-4 py-24 sm:px-6">
        <div className="mx-auto max-w-6xl">
          <div className="mb-16 text-center">
            <h2 className="mb-4 text-4xl font-bold text-gray-900 md:text-5xl">
              Everything between the shoot
              <br />
              <span className={GRADIENT_TEXT}>and the post</span>
            </h2>
            <p className="mx-auto max-w-2xl text-xl text-gray-600">Built for people who make content alongside a real job, not instead of one.</p>
          </div>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-2xl border border-gray-100 bg-white p-6 transition-all duration-200 hover:border-gray-200 hover:shadow-lg">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-gray-100">
                  <f.icon className="h-6 w-6 text-gray-700" aria-hidden="true" />
                </div>
                <h3 className="mb-2 text-lg font-semibold text-gray-900">{f.title}</h3>
                <p className="leading-relaxed text-gray-600">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="texting" className="scroll-mt-20 px-4 pb-24 sm:px-6">
        <div className="mx-auto max-w-4xl rounded-3xl border border-gray-100 bg-white p-8 shadow-sm md:p-12">
          <h2 className="mb-4 text-3xl font-bold text-gray-900">
            Text the <span className={GRADIENT_TEXT}>editor</span>
          </h2>
          <div className="space-y-4 text-gray-600">
            <p>
              Account holders can turn on text messages from {SITE.textingProgram}: text &ldquo;new reel&rdquo; or &ldquo;new
              story&rdquo; to start a video, reply with changes, and get links to previews and a confirmation when a post goes out.
              Every message is saved to your account, so you can pick the conversation up in the app.
            </p>
            <p>
              <span className="font-semibold text-gray-900">How to sign up:</span> sign in, open Settings, enter your mobile number,
              tick the box agreeing to receive texts, and enter the code we text you. Texting is optional and not required to use{" "}
              {SITE.productName}.
            </p>
            <p className="text-sm">
              Message frequency varies with your activity. Message and data rates may apply. Reply STOP to cancel, HELP for help. See
              the{" "}
              <Link href="/texting" className="text-orange-600 underline underline-offset-4">
                texting terms
              </Link>{" "}
              and{" "}
              <Link href="/privacy" className="text-orange-600 underline underline-offset-4">
                privacy policy
              </Link>
              .
            </p>
          </div>
        </div>
      </section>

      <section id="faq" className="scroll-mt-20 px-4 pb-24 sm:px-6">
        <div className="mx-auto max-w-3xl">
          <div className="mb-16 text-center">
            <h2 className="mb-4 text-4xl font-bold text-gray-900 md:text-5xl">
              Frequently asked <span className={GRADIENT_TEXT}>questions</span>
            </h2>
          </div>
          <div className="space-y-3">
            {FAQS.map((f) => (
              <details key={f.q} className="group overflow-hidden rounded-xl border border-gray-100 bg-white">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-6 py-4 font-medium text-gray-900 hover:bg-gray-50 [&::-webkit-details-marker]:hidden">
                  {f.q}
                  <ChevronDown className="h-5 w-5 shrink-0 text-gray-400 transition-transform group-open:rotate-180" aria-hidden="true" />
                </summary>
                <p className="px-6 pb-4 leading-relaxed text-gray-600">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="px-4 pb-24 sm:px-6">
        <div className="relative mx-auto max-w-4xl overflow-hidden rounded-3xl bg-gradient-to-r from-amber-500 via-orange-500 to-orange-600 p-12 text-center">
          <div className="absolute left-1/4 top-0 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
          <div className="relative z-10">
            <h2 className="mb-4 text-4xl font-bold text-white md:text-5xl">Your next reel is already on your phone.</h2>
            <p className="mx-auto mb-8 max-w-xl text-xl text-white/85">Upload the clips and get a cut back to review.</p>
            <a href={`${APP}/login`} className="inline-flex items-center gap-2 rounded-lg bg-white px-6 py-3 font-semibold text-orange-600 transition-all hover:bg-gray-100">
              Get started
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
