"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Music } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface Track {
  id: string;
  title: string;
  seconds: number;
  bpm: number | null;
  source: string;
  active: boolean;
  url: string | null;
}

async function load(): Promise<Track[]> {
  const res = await fetch("/api/admin/music", { cache: "no-store" });
  const json = (await res.json().catch(() => ({}))) as { tracks?: Track[]; error?: string };
  if (!res.ok || !json.tracks) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json.tracks;
}

const length = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

/** Admin > Music: the tracks the editor can choose from, and the Epidemic Sound connection to come. */
export default function AdminMusicPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({ queryKey: ["admin-music"], queryFn: load });
  const toggle = useMutation({
    mutationFn: async (v: { id: string; active: boolean }) => {
      const res = await fetch("/api/admin/music", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(v) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return v;
    },
    onSuccess: (v) => qc.setQueryData<Track[]>(["admin-music"], (old) => old?.map((t) => (t.id === v.id ? { ...t, active: v.active } : t))),
    onError: (e) => toast.error((e as Error).message),
  });
  const on = data?.filter((t) => t.active).length ?? 0;

  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0 pb-2">
          <div>
            <CardTitle className="text-base">Epidemic Sound</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Let each brand connect its own Epidemic Sound account, so the editor can search and use the tracks their subscription covers.
            </p>
          </div>
          <Badge variant="outline" className="shrink-0">Coming soon</Badge>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Built-in tracks</CardTitle>
          <p className="text-sm text-muted-foreground">
            The music the editor can choose from today. Turn a track off to keep it out of new cuts.
            {data ? ` ${on} of ${data.length} on.` : ""}
          </p>
        </CardHeader>
        <CardContent className="flex flex-col divide-y">
          {isLoading && <p className="py-3 text-sm text-muted-foreground">Loading…</p>}
          {isError && <p className="py-3 text-sm text-muted-foreground">Sign in as the admin to see the music.</p>}
          {data && data.length === 0 && <p className="py-3 text-sm text-muted-foreground">No tracks yet. Run scripts/import-music.ts to add the music folder.</p>}
          {data?.map((t) => (
            <div key={t.id} className={cn("flex flex-wrap items-center gap-3 py-3", !t.active && "opacity-50")}>
              <Music className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{t.title}</p>
                <p className="text-xs text-muted-foreground">
                  {length(t.seconds)}
                  {t.bpm ? ` · ${Math.round(t.bpm)} bpm` : ""}
                </p>
              </div>
              {t.url && <audio controls preload="none" src={t.url} className="h-8 w-56 max-w-full" />}
              <button
                type="button"
                onClick={() => toggle.mutate({ id: t.id, active: !t.active })}
                disabled={toggle.isPending}
                className="rounded-md border px-3 py-1 text-sm hover:bg-muted"
              >
                {t.active ? "Turn off" : "Turn on"}
              </button>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
