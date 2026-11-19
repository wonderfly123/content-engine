"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, TriangleAlert } from "lucide-react";
import { SkillEditor } from "@/app/admin/skill/skill-editor";

/**
 * The technical steps the editor follows (scan, cut, render, check, the result format). Platform-wide
 * and only the platform admin edits them, through the admin skill API; everyone else sees a short note.
 */
export function AdvancedSteps({ canEdit }: { canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-lg border">
      <button type="button" className="flex w-full items-center gap-2 px-4 py-3 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        <span className="font-medium">Advanced</span>
        <span className="text-sm text-muted-foreground">How the editor works, step by step</span>
      </button>
      {open && (
        <div className="flex flex-col gap-4 border-t p-4">
          {canEdit ? (
            <>
              <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />
                <p>
                  These steps apply to every brand on the platform. A mistake here can break every edit until it&apos;s fixed. SKILL.md can&apos;t be
                  saved without its out/manifest.json section. Every save is kept, so you can bring an older version back or reset to default.
                </p>
              </div>
              <SkillEditor />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              The technical steps (how clips are scanned, cut, rendered and checked) are the same for everyone and looked after by the platform team.
              Your style above is what makes the edits yours.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
