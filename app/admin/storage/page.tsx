"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface Loaded {
  retention: string;
  options: Array<{ value: string; label: string }>;
}

async function request(retention?: string): Promise<Loaded> {
  const res = await fetch("/api/admin/storage", retention
    ? { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ retention }) }
    : { cache: "no-store" });
  const json = (await res.json().catch(() => ({}))) as Partial<Loaded> & { error?: string };
  if (!res.ok || !json.retention || !json.options) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json as Loaded;
}

/** Admin > Storage: how long raw clips are kept after their video is finished. */
export default function AdminStoragePage() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({ queryKey: ["admin-storage"], queryFn: () => request() });
  const save = useMutation({
    mutationFn: (value: string) => request(value),
    onSuccess: (loaded) => {
      qc.setQueryData(["admin-storage"], loaded);
      toast.success("Saved");
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const current = save.isPending ? save.variables : data?.retention;

  return (
    <Card className="max-w-2xl">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Keep raw clips</CardTitle>
        <p className="text-sm text-muted-foreground">
          How long the footage people upload is kept after its video is finished (posted, or replaced by a new reel or story). Clips
          for a video still in progress are never deleted, and finished videos are never touched. Checked every hour; deleting
          can&apos;t be undone.
        </p>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {isError && <p className="text-sm text-muted-foreground">Sign in as the admin to change this.</p>}
        {data && (
          <div role="radiogroup" aria-label="Keep raw clips" className="flex flex-wrap gap-2">
            {data.options.map((o) => (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={current === o.value}
                disabled={save.isPending}
                onClick={() => current !== o.value && save.mutate(o.value)}
                className={cn(
                  "rounded-md border px-3 py-1.5 text-sm transition-colors",
                  current === o.value ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
