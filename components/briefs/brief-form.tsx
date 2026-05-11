"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { BriefRow } from "./brief-card";

interface BriefFormProps {
  brief: BriefRow;
  onSave: (patch: Partial<BriefRow>) => Promise<void> | void;
  onCancel: () => void;
}

export function BriefForm({ brief, onSave, onCancel }: BriefFormProps) {
  const [title, setTitle] = useState(brief.title);
  const [hook, setHook] = useState(brief.hook);
  const [angle, setAngle] = useState(brief.angle);
  const [keyMessage, setKeyMessage] = useState(brief.keyMessage);
  const [hashtags, setHashtags] = useState(brief.suggestedHashtags.join(", "));
  const [cta, setCta] = useState(brief.suggestedCta ?? "");
  const [target, setTarget] = useState(brief.targetPublishDate ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({
        title,
        hook,
        angle,
        keyMessage,
        suggestedHashtags: hashtags
          .split(",")
          .map((s) => s.trim().replace(/^#/, ""))
          .filter(Boolean),
        suggestedCta: cta || null,
        targetPublishDate: target || null,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="brief-title">Title</Label>
        <Input
          id="brief-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          maxLength={200}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="brief-hook">Hook</Label>
        <Textarea
          id="brief-hook"
          value={hook}
          onChange={(e) => setHook(e.target.value)}
          rows={2}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="brief-angle">Angle</Label>
        <Textarea
          id="brief-angle"
          value={angle}
          onChange={(e) => setAngle(e.target.value)}
          rows={2}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="brief-key-message">Key message</Label>
        <Textarea
          id="brief-key-message"
          value={keyMessage}
          onChange={(e) => setKeyMessage(e.target.value)}
          rows={3}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="brief-hashtags">Hashtags (comma separated)</Label>
        <Input
          id="brief-hashtags"
          value={hashtags}
          onChange={(e) => setHashtags(e.target.value)}
          placeholder="strength, kidsfitness"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="brief-cta">CTA</Label>
          <Input
            id="brief-cta"
            value={cta}
            onChange={(e) => setCta(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="brief-target">Target publish date</Label>
          <Input
            id="brief-target"
            type="date"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          />
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save edits"}
        </Button>
      </div>
    </form>
  );
}
