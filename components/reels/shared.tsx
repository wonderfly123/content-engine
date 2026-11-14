"use client";

import { Input } from "@/components/ui/input";
import type { ReelCutView } from "@/lib/reels/store";

export const keyOf = (cut: ReelCutView) => `${cut.job}/${cut.id}`;

export const mediaUrl = (cut: ReelCutView, file: string) => `/api/reels/media?job=${encodeURIComponent(cut.job)}&file=${encodeURIComponent(file)}`;

export async function send(url: string, init: RequestInit): Promise<void> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`);
}

export const patch = (body: Record<string, unknown>) =>
  send("/api/reels", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/** Video on the left, everything else on the right; stacks on a narrow screen. */
export function Split({ video, children }: { video: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,19rem)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-3">{video}</div>
      <div className="flex min-w-0 flex-col gap-3">{children}</div>
    </div>
  );
}

export function Player({ cut, file, videoRef }: { cut: ReelCutView; file: string; videoRef?: React.RefObject<HTMLVideoElement | null> }) {
  return (
    <video
      ref={videoRef}
      src={mediaUrl(cut, file)}
      controls
      playsInline
      preload="metadata"
      className="aspect-[9/16] w-full rounded-md bg-black object-contain"
    />
  );
}

/** Opening on-screen text: one of the editor's drafts, the reviewer's own words, or none. */
export function HookPicker({ options, value, onChange }: { options: string[]; value: string; onChange: (hook: string) => void }) {
  return (
    <>
      <div className="flex flex-col gap-1" role="radiogroup" aria-label="Opening text">
        {["", ...options].map((o, i) => (
          <button key={o || "none"} type="button" role="radio" aria-checked={value.trim() === o} onClick={() => onChange(o)}
            className={`rounded-md border px-3 py-1.5 text-left text-sm ${value.trim() === o ? "border-primary bg-primary/10 font-medium" : "hover:bg-muted"}`}>
            {o ? <><span className="mr-2 text-muted-foreground">{i}</span>{o}</> : <span className="text-muted-foreground">No opening text</span>}
          </button>
        ))}
      </div>
      <Input value={value} onChange={(e) => onChange(e.target.value)} maxLength={120} placeholder="Or write your own" aria-label="Write your own opening text" />
    </>
  );
}
