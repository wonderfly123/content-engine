"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SECTIONS, type SectionValue, type StyleSectionId } from "@/lib/editor/style-schema";
import type { EditorStyleResponse } from "@/lib/editor/style-view";
import { decideRequest, styleRequest, type StyleChange } from "./api";
import { AdvancedSteps } from "./advanced";
import { SectionCard } from "./section-card";

/** Settings > Editor style: how the cloud editor cuts this brand's videos. */
export function EditorStyle({ brandId, brandName }: { brandId: string; brandName: string }) {
  const qc = useQueryClient();
  const key = ["editor-style", brandId];
  const { data, isLoading, isError } = useQuery({ queryKey: key, queryFn: () => styleRequest(brandId) });
  const [drafts, setDrafts] = useState<Partial<Record<StyleSectionId, SectionValue>>>({});

  const settle = (next: EditorStyleResponse, section?: StyleSectionId) => {
    qc.setQueryData(key, next);
    if (section) {
      qc.invalidateQueries({ queryKey: ["editor-style-history", brandId, section] });
      setDrafts((d) => {
        const copy = { ...d };
        delete copy[section];
        return copy;
      });
    }
  };

  const change = useMutation({
    mutationFn: (c: StyleChange) => styleRequest(brandId, c),
    onSuccess: (next, c) => {
      settle(next, c.section);
      toast.success(c.action === "save" ? "Saved. Your next edit uses it." : c.action === "reset" ? "Back to the default" : "Older version brought back");
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const decide = useMutation({
    mutationFn: (v: { id: string; decision: "accept" | "dismiss"; section: StyleSectionId }) => decideRequest(brandId, v.id, v.decision),
    onSuccess: (next, v) => {
      settle(next, v.decision === "accept" ? v.section : undefined);
      toast.success(v.decision === "accept" ? "Added to your style" : "Dismissed");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (isError || !data) return <p className="text-sm text-muted-foreground">Couldn&apos;t load the editor style.</p>;
  const busy = change.isPending || decide.isPending;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-sm text-muted-foreground">
          How the editor cuts videos for <strong>{brandName}</strong>. Everything starts from how it edits today; change only what you want
          different. What you ask for in a chat still comes first.
        </p>
      </div>

      {data.suggestions.length > 0 && (
        <div className="rounded-md border bg-muted/40 p-3">
          <p className="text-sm font-medium">
            {data.suggestions.length === 1 ? "1 suggested tweak" : `${data.suggestions.length} suggested tweaks`} from your recent feedback
          </p>
          <ul className="mt-1 flex flex-col gap-1">
            {data.suggestions.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted-foreground">{s.sectionTitle}:</span>
                <span className="min-w-0 flex-1">{s.change}</span>
                <Button size="sm" variant="link" className="h-auto p-0" onClick={() => document.getElementById(`style-${s.section}`)?.scrollIntoView({ behavior: "smooth" })}>
                  Review
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {SECTIONS.map((def) => {
        const view = data.sections.find((s) => s.id === def.id);
        if (!view) return null;
        return (
          <SectionCard
            key={def.id}
            brandId={brandId}
            def={def}
            view={view}
            draft={drafts[def.id]}
            onDraft={(v) => setDrafts((d) => ({ ...d, [def.id]: v }))}
            suggestion={data.suggestions.find((s) => s.section === def.id)}
            busy={busy}
            onChange={(c) => change.mutate(c)}
            onDecide={(id, decision) => decide.mutate({ id, decision, section: def.id })}
          />
        );
      })}

      <AdvancedSteps canEdit={data.canEditAdvanced} />
    </div>
  );
}
