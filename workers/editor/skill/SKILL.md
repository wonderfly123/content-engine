---
name: cutting-montage-videos
description: Use for every Nekter editing job - turn the clips in footage/ into short vertical clean-cut videos (reels and stories) with opening-text options and a post caption, or revise earlier cuts, and write out/manifest.json.
---

# Cutting vertical videos (cloud)

You are editing one job, unattended, in this folder. Nobody can answer while you work. Make the cuts, check
them, write `out/manifest.json`, and finish. Do not plan at length.

Fixed rules: vertical 1080x1920, 30 fps, clean cuts only (no transitions, no effects, no text burned in).
Every cut has music from `music/`, cut on the beat, unless the request or instructions say no music
(or `job.json` lists no tracks): then it is silent. No voice-over.

## The folder

```
job.json         the brief: kind, videoKind, brand {name, voice}, instructions, request, clips, music
previous.json    revisions only: the last manifest; each EDL entry has its footage `file`, each cut its `music`
footage/         the clips (flat; filenames as listed in job.json)
music/           the music library (filenames as listed in job.json `music`, with title, bpm, loudestFrom)
work/            yours: scan, samples, EDL drafts
out/             manifest.json and the preview .mp4 files
```

`SK=.claude/skills/cutting-montage-videos/scripts`. Use relative paths only; never leave this folder.
Clips are only ever read; never modify or delete anything in `footage/`.

## Workflow (first cut)

1. **Brief**: read `job.json`. `request` is what the person asked for; `instructions` are the workspace's own
   standing rules (follow them unless the request says otherwise); `brand.voice` is how they talk.
2. **Scan**: `python3 $SK/scan.py footage work/scan`. Read every `work/scan/sheet-N.jpg`; that is enough to
   understand the shoot. Clips flagged `unreadable` are never used.
3. **Intake**: decide everything from the brief with `intake.md`. Do not ask unless it says to.
4. **Select**: shortlist clips per cut, then `printf '%s\n' clipA.mov clipB.mov | bash $SK/sample.sh footage work/samples/<cut>`
   for gated frame sampling (4 / 6 / 10 frames by clip length; it prints each frame's time). Read the sheets and
   choose moments with the profile `intake.md` picks (`profiles/build.md` or `profiles/event.md`). Sample every
   clip you might use and pick the part where the moment happens; never take a clip from its start by default.
   Decide per shot: a real-speed snippet (the default) or sped up (only pans and long takes, per the profile).
5. **Assemble**: write a draft EDL per cut in `work/edl/<id>.draft.tsv`, one shot per line:
   `clip_filename|in_seconds|source_seconds|speed|crop_x(optional)` (filename as in `footage/`, no folder).
   Then `python3 $SK/fit.py footage work/edl/<id>.draft.tsv <seconds> work/edl/<id>.tsv` (exact length,
   bounds, no reused range, pacing). Fix every problem it reports and run it again; a pacing problem means
   more, shorter real-speed shots, not faster ones.
   **Music** (unless no music is wanted): pick one track per cut from `job.json` `music` that fits the brief and
   pace (follow any sound or music instruction in `request` or `instructions`; title and tempo are all you know;
   prefer `beatStrength` above ~2; a track with null `bpm` can be read with `python3 $SK/music.py info music/<file>`).
   Then `python3 $SK/beatfit.py footage work/edl/<id>.tsv music/<file> auto <seconds> work/edl/<id>.beat.tsv`
   re-times the same shots onto the beat and prints `audio_start` and `video_seconds`. From here on use the
   `.beat.tsv` as the cut's EDL and `video_seconds` as its `seconds`. `auto` starts at the loudest stretch (the
   chorus or drop); give a number instead to start elsewhere.
6. **Render**: `bash $SK/render.sh footage work/edl/<id>.tsv out/previews/<id>.mp4` (the `.beat.tsv` with music).
   With music, then `bash $SK/mix.sh out/previews/<id>.mp4 music/<file> <audio_start>` (sets loudness and a short
   fade out). Read
   `out/previews/<id>.check.jpg`: every shot upright, filling the frame, not black, and the strongest part of its
   clip under the profile. Fix the EDL and render again if not. Do 15s first, then 30s.
7. **Words**: for each cut, ~10 `hookOptions` per `hooks.md` and a `caption` per `captions.md`. Suggest `coverAt`:
   seconds into the cut of the best cover frame (the finished result, no motion blur).
8. **Manifest**: write `out/manifest.json` (below). `python3 $SK/edl2json.py json work/edl/<id>.tsv` prints each
   cut's `edl` array exactly as rendered; paste it in unchanged. Then finish with one short line.

## Revisions

Read `previous.json` and the request. Change only what was asked; everything else stays exactly as it was.
- A cut that does not change: copy its manifest entry unchanged, including `preview` `{"key": ...}`.
- A cut that changes: `python3 $SK/edl2json.py tsv previous.json <id> work/edl/<id>.prev.tsv`, edit that EDL as
  asked (keep every shot the request does not touch), then fit (only if the length must change), render, check
  as above, and give the cut `preview` `{"path": ...}`. Keep its `id`. New words only if the request is about words.
- A new cut asked for: make it as in a first cut, with a new `id`.
- "Change the song": start from the previous EDL, pick a different track, beatfit, render, mix. "No music":
  render the previous EDL as is, no mix, `music` null. Both count as a cut that changes.
If the request is unclear about which cut it means, apply it to the cut it most plausibly means and say so in the reply.

## out/manifest.json

```json
{
  "reply": "Two cuts are ready: a 15s and a 30s, both opening on the finished stand. ...",
  "question": null,
  "cuts": [
    {
      "id": "reel-15", "title": "Stand 15s", "seconds": 15, "mode": "music",
      "preview": {"path": "out/previews/reel-15.mp4"},
      "edl": [{"file": "IMG_0412.mov", "in": 3.2, "dur": 1.1, "speed": 1, "cropX": null}],
      "hookOptions": ["...", "..."], "caption": "...", "script": null, "coverAt": 13.5,
      "music": {"file": "03-summer-days.mp3", "start": 41.218}
    }
  ]
}
```

- `mode` is always `"music"` and `script` always `null` (no voice-over yet). `seconds` is the cut's length.
- `music`: the track's `file` and the `audio_start` the preview was mixed from, or `null` for a silent cut.
- Ids: lowercase with dashes (`reel-15`, `reel-30`, `story-15`). Titles are plain ("Stand 30s").
- `reply`: what goes back into the conversation, in the owner's plain voice: two or three short sentences on what
  you made and any choice they might want to change (an odd clip left out, a segment with only one angle). No lists
  of files, no technical terms, no praise of your own work.
- `question`: `null`, or ONE short question when something essential is missing (see `intake.md`). With a
  question you may still deliver cuts; if you truly cannot make anything, `cuts` is `[]`.
- Keep all text plain: no markdown, no emojis except in `caption`.

## Common mistakes

- Taking a one-second slice of a pan. Use the whole pan sped up.
- Trusting a clip's reported frame rate or length without `scan.py`.
- An `edl` in the manifest that differs from the EDL the preview was rendered from. Always use `edl2json.py`.
- Inventing facts in hooks or captions. Only the brief and what the footage shows.
