"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Loader2, Music, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
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

/** The file's length in seconds, read by the browser (no upload needed). */
function durationOf(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    const url = URL.createObjectURL(file);
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(audio.duration);
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`${file.name} couldn't be read as audio.`));
    };
    audio.src = url;
  });
}

async function post<T>(body: unknown): Promise<T> {
  const res = await fetch("/api/admin/music", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json;
}

async function uploadTrack(file: File): Promise<void> {
  const seconds = await durationOf(file);
  const { key, url } = await post<{ key: string; url: string }>({ action: "start", filename: file.name, size: file.size });
  const put = await fetch(url, { method: "PUT", body: file, headers: { "Content-Type": file.type || "audio/mpeg" } });
  if (!put.ok) throw new Error(`${file.name} didn't upload (HTTP ${put.status}).`);
  await post({ action: "finish", key, title: file.name.replace(/\.[a-z0-9]+$/i, ""), seconds });
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
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const upload = async (files: File[]) => {
    for (const file of files) {
      setUploading(file.name);
      try {
        await uploadTrack(file);
        toast.success(`Added ${file.name}`);
      } catch (e) {
        toast.error((e as Error).message);
      }
    }
    setUploading(null);
    await qc.invalidateQueries({ queryKey: ["admin-music"] });
  };

  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle className="text-base">Upload your own tracks</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Add songs or sounds you have the rights to (.mp3, .m4a, .aac or .wav, up to 50 MB each). The editor picks the best part
              of a track and cuts your video to its beat during edits.
            </p>
          </div>
          <input
            ref={input}
            type="file"
            accept="audio/*,.mp3,.m4a,.aac,.wav"
            multiple
            className="hidden"
            onChange={(e) => {
              void upload(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
          <Button className="shrink-0" disabled={uploading !== null} onClick={() => input.current?.click()}>
            {uploading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <Upload className="mr-1.5 h-4 w-4" aria-hidden="true" />}
            {uploading ? "Uploading…" : "Upload tracks"}
          </Button>
        </CardHeader>
        {uploading && <CardContent className="pt-0 text-sm text-muted-foreground">Uploading {uploading}…</CardContent>}
      </Card>

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
