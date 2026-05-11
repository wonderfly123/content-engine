"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { saveProfile } from "@/app/onboarding/[brandId]/actions";
import { profileSchema, type ProfileInput } from "@/lib/onboarding/types";
import { ChipInput } from "./chip-input";
import { VoiceToneSliders, type ToneKey } from "./voice-tone-sliders";
import { VoiceExamplesInput } from "./voice-examples-input";

const ARCHETYPES = [
  "hero",
  "sage",
  "jester",
  "outlaw",
  "explorer",
  "regular-guy",
  "lover",
  "caregiver",
  "ruler",
  "creator",
  "innocent",
  "magician",
] as const;

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "")
    .slice(0, 60);
}

interface ProfileFormProps {
  brandId: string;
  initial: ProfileInput;
}

export function ProfileForm({ brandId, initial }: ProfileFormProps) {
  const [v, setV] = useState<ProfileInput>(initial);
  const [slugTouched, setSlugTouched] = useState(false);
  const [pending, startTransition] = useTransition();

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = profileSchema.safeParse(v);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      toast.error(`${first?.path.join(".") ?? "form"}: ${first?.message}`);
      return;
    }
    startTransition(async () => {
      const res = await saveProfile(brandId, parsed.data);
      // saveProfile redirects on success; reaching here implies an error.
      if (res && !res.ok) toast.error(res.error);
    });
  };

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Basics</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="name">Brand name</Label>
              <Input
                id="name"
                value={v.name}
                onChange={(e) => {
                  const name = e.target.value;
                  setV((prev) => ({
                    ...prev,
                    name,
                    slug: slugTouched ? prev.slug : slugify(name) || prev.slug,
                  }));
                }}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="slug">Slug</Label>
              <Input
                id="slug"
                value={v.slug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setV({ ...v, slug: e.target.value });
                }}
                required
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tagline">One-line tagline</Label>
            <Input
              id="tagline"
              value={v.tagline ?? ""}
              onChange={(e) => setV({ ...v, tagline: e.target.value })}
              maxLength={280}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="audience">Audience summary</Label>
            <Textarea
              id="audience"
              value={v.audienceSummary ?? ""}
              onChange={(e) => setV({ ...v, audienceSummary: e.target.value })}
              rows={3}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Persona</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="archetype">Archetype</Label>
              <Select
                value={v.archetype}
                onValueChange={(value) =>
                  setV({ ...v, archetype: value as ProfileInput["archetype"] })
                }
              >
                <SelectTrigger id="archetype" className="w-full">
                  <SelectValue placeholder="Choose an archetype" />
                </SelectTrigger>
                <SelectContent>
                  {ARCHETYPES.map((a) => (
                    <SelectItem key={a} value={a}>
                      {a}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="traits">Traits</Label>
              <ChipInput
                id="traits"
                value={v.traits}
                onChange={(traits) => setV({ ...v, traits })}
                placeholder="Add trait, press Enter"
                ariaLabel="Traits"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pov">Point of view</Label>
            <Textarea
              id="pov"
              value={v.pointOfView ?? ""}
              onChange={(e) => setV({ ...v, pointOfView: e.target.value })}
              rows={3}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Voice — tone</CardTitle>
        </CardHeader>
        <CardContent>
          <VoiceToneSliders
            value={v.toneSliders as Record<ToneKey, number>}
            onChange={(toneSliders) => setV({ ...v, toneSliders })}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Voice — language</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="emoji">Emoji policy</Label>
              <Select
                value={v.emojiPolicy}
                onValueChange={(value) =>
                  setV({ ...v, emojiPolicy: value as ProfileInput["emojiPolicy"] })
                }
              >
                <SelectTrigger id="emoji" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="sparing">Sparing</SelectItem>
                  <SelectItem value="liberal">Liberal</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hashtag">Hashtag style</Label>
              <Select
                value={v.hashtagStyle}
                onValueChange={(value) =>
                  setV({
                    ...v,
                    hashtagStyle: value as ProfileInput["hashtagStyle"],
                  })
                }
              >
                <SelectTrigger id="hashtag" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="few-strategic">Few, strategic</SelectItem>
                  <SelectItem value="many-broad">Many, broad</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reading">Reading level</Label>
              <Select
                value={v.readingLevel}
                onValueChange={(value) =>
                  setV({
                    ...v,
                    readingLevel: value as ProfileInput["readingLevel"],
                  })
                }
              >
                <SelectTrigger id="reading" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="grade-school">Grade school</SelectItem>
                  <SelectItem value="middle-school">Middle school</SelectItem>
                  <SelectItem value="general">General</SelectItem>
                  <SelectItem value="college">College</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="banned">Banned words</Label>
              <ChipInput
                id="banned"
                value={v.bannedWords}
                onChange={(bannedWords) => setV({ ...v, bannedWords })}
                placeholder="Add word, press Enter"
                ariaLabel="Banned words"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="signature">Signature phrases</Label>
              <ChipInput
                id="signature"
                value={v.signaturePhrases}
                onChange={(signaturePhrases) =>
                  setV({ ...v, signaturePhrases })
                }
                placeholder="Add phrase, press Enter"
                ariaLabel="Signature phrases"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="freeform">Voice freeform</Label>
            <Textarea
              id="freeform"
              value={v.voiceFreeform ?? ""}
              onChange={(e) => setV({ ...v, voiceFreeform: e.target.value })}
              rows={6}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Example posts</CardTitle>
        </CardHeader>
        <CardContent>
          <VoiceExamplesInput
            value={v.voiceExamples}
            onChange={(voiceExamples) => setV({ ...v, voiceExamples })}
          />
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save and continue"}
        </Button>
      </div>
    </form>
  );
}
