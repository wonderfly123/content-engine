"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ExternalLink, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { removeConnection, saveConnection } from "@/app/settings/connection-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface ConnectionItem {
  provider: string;
  name: string;
  usedFor: string;
  required: boolean;
  getKeyUrl: string;
  steps: string[];
  connected: boolean;
  status: "ok" | "failing" | null;
  lastCheckError: string | null;
}

/** One card per outside service the workspace brings its own key for. The stored key is never shown. */
export function ConnectionsCard({ items, canEdit }: { items: ConnectionItem[]; canEdit: boolean }) {
  return (
    <div className="space-y-4">
      {items.map((item) => (
        <ConnectionRow key={item.provider} item={item} canEdit={canEdit} />
      ))}
      {!canEdit && <p className="text-xs text-muted-foreground">Only the workspace owner can change connections.</p>}
    </div>
  );
}

function ConnectionRow({ item, canEdit }: { item: ConnectionItem; canEdit: boolean }) {
  const router = useRouter();
  const [secret, setSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const inputId = `key-${item.provider}`;

  const save = () =>
    start(async () => {
      setError(null);
      const res = await saveConnection({ provider: item.provider, secret });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSecret("");
      toast.success(`${item.name} connected.`);
      router.refresh();
    });

  const remove = () =>
    start(async () => {
      setError(null);
      const res = await removeConnection({ provider: item.provider });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      toast.success(`${item.name} disconnected.`);
      router.refresh();
    });

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="text-base">
            {item.name}
            {!item.required && <span className="ml-2 text-xs font-normal text-muted-foreground">optional</span>}
          </CardTitle>
          <CardDescription>{item.usedFor}</CardDescription>
        </div>
        {item.connected && item.status === "failing" ? (
          <Badge variant="destructive" className="shrink-0">
            <TriangleAlert className="mr-1 h-3 w-3" aria-hidden="true" />
            Not working
          </Badge>
        ) : item.connected ? (
          <Badge className="shrink-0">
            <Check className="mr-1 h-3 w-3" aria-hidden="true" />
            Connected
          </Badge>
        ) : (
          <Badge variant="outline" className="shrink-0">
            Not connected
          </Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {item.connected && item.status === "failing" && item.lastCheckError && (
          <p className="text-sm text-destructive">Last check: {item.lastCheckError} Paste a new key to replace it.</p>
        )}
        {canEdit && (
          <div className="space-y-2">
            <Label htmlFor={inputId}>{item.connected ? "Replace key" : "API key"}</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id={inputId}
                type="password"
                autoComplete="off"
                placeholder={item.connected ? "A key is stored. Paste a new one to replace it." : "Paste your key"}
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                disabled={pending}
              />
              <Button onClick={save} disabled={pending || secret.trim().length < 8} className="shrink-0">
                {pending ? "Testing..." : "Test and save"}
              </Button>
              {item.connected && (
                <Button variant="outline" onClick={remove} disabled={pending} className="shrink-0">
                  Remove
                </Button>
              )}
            </div>
            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
            <details className="group rounded-md border bg-muted/30 px-3 py-2 text-sm" open={!item.connected}>
              <summary className="cursor-pointer list-none font-medium [&::-webkit-details-marker]:hidden">
                How to get a key <span className="text-muted-foreground group-open:hidden">({item.steps.length} steps)</span>
              </summary>
              <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-muted-foreground">
                {item.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              <a href={item.getKeyUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-sm font-medium underline-offset-4 hover:underline">
                Open the Anthropic Console
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
              </a>
            </details>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
