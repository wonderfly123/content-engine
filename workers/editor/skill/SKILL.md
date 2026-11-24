---
name: cutting-montage-videos
description: Use for every Nekter editing job - turn the clips in footage/ into short vertical clean-cut videos (reels and stories) with opening-text options and a post caption, or revise earlier cuts, and write out/manifest.json.
---

# Cutting vertical videos (cloud)

You are editing one job, unattended, in this folder. Nobody can answer while you work. Make the cuts, check
them, write `out/manifest.json`, and finish. Do not plan at length.

Fixed rules: vertical 1080x1920, 30 fps, clean cuts only (no transitions, no effects, no text burned in).
Every cut has music from `music/`, cut on the beat, unless the request or instructions say no music
(or `job.json` lists no tracks): then it has no music. No voice-over is added, but a shot can keep its clip's
own sound: when someone talks on camera, their words are part of the video (see "Sound from the clips").

## The folder

```
job.json         the brief: kind, videoKind, brand {name, voice}, instructions, request, history, clips, music, epidemicSound
previous.json    revisions only: the last manifest; each EDL entry has its footage `file`, each cut its `music`
footage/         the clips (flat; filenames as listed in job.json)
music/           the music library (filenames as listed in job.json `music`, with title, bpm, loudestFrom)
work/            yours: scan, listen, moments, samples, EDL drafts
out/             manifest.json and the preview .mp4 files
```

`SK=.claude/skills/cutting-montage-videos/scripts`. Use relative paths only; never leave this folder.
Clips are only ever read; never modify or delete anything in `footage/`.

## Workflow (first cut)

1. **Brief**: read `job.json`. `request` is what the person asked for; `history` is what they said earlier in the
   same conversation, oldest first, and still stands unless a later message changes it; `instructions` are the
   workspace's own standing rules (follow them unless the request says otherwise); `brand.voice` is how they talk.
2. **Scan, listen, find the action**: three commands, then read what they print.
   - `python3 $SK/scan.py footage work/scan`: read every `work/scan/sheet-N.jpg` to understand the shoot. Clips
     flagged `unreadable` are never used.
   - `python3 $SK/listen.py footage work/listen`: which clips have someone talking, what they say and when
     (`work/listen/speech.tsv`). A clip marked `TALKING` was filmed for its words.
   - `python3 $SK/moments.py footage work/moments`: for every clip of 8s or more, the windows where the most
     happens (movement and sound hits) and the quiet stretches to avoid.
3. **Intake**: decide everything from the brief with `intake.md`. Do not ask unless it says to.
4. **Select**: shortlist clips per cut, then `printf '%s\n' clipA.mov clipB.mov | bash $SK/sample.sh footage work/samples/<cut>`
   (a frame about every 5 seconds through each clip; it prints each frame's time). Read the sheets and choose
   moments with the profile `intake.md` picks (`profiles/build.md`, `profiles/event.md` or `profiles/training.md`).
   **Never pick a moment from one frame.** For every shot you want from a clip over 15s, start from the strongest
   windows `moments.py` printed, then look closely at each candidate: `printf '%s\n' 'clip.mov|41|47' | bash $SK/sample.sh footage work/samples/zoom-1`
   (several lines at once is fine). Use it only if the frames show the moment actually happening (the hit landing,
   the rep, the reaction), and start the shot about half a second before it. A window where people only walk,
   reset, wait or stand is not a shot, however sharp it looks. Never take a clip from its start by default.
   Decide per shot: a real-speed snippet (the default) or sped up (only pans and long takes, per the profile).
5. **Assemble**: write a draft EDL per cut in `work/edl/<id>.draft.tsv`, one shot per line:
   `clip_filename|in_seconds|source_seconds|speed|crop_x(optional)|sound(optional)` (filename as in `footage/`,
   no folder; `sound` is `1` on a shot that keeps its clip's own sound, so `talk.mov|0.8|5.1|1||1`).
   Then `python3 $SK/fit.py footage work/edl/<id>.draft.tsv <seconds> work/edl/<id>.tsv <pace>` (exact length,
   bounds, no reused range, pacing). `<pace>` is `quick` (fast montage, the default) or `held` (shots run 2 to 5
   seconds): use `held` whenever the request, `history`, `style.md` or the profile asks for longer shots, fewer cuts
   or less choppy editing, and keep using it on every later revision of that conversation. Fix every problem it
   reports and run it again; a `quick` pacing problem means more, shorter real-speed shots, not faster ones.
   **Music** (unless no music is wanted): pick one track per cut from `job.json` `music` that fits the brief and
   pace (follow any sound or music instruction in `request` or `instructions`; title and tempo are all you know;
   prefer `beatStrength` above ~2; a track with null `bpm` can be read with `python3 $SK/music.py info music/<file>`).
   When `job.json` has `"epidemicSound": true`, the brand's Epidemic Sound account is also an option: `epidemic-sound.md`
   says when to use it and how to bring a track from it into `music/`.
   Then `python3 $SK/beatfit.py footage work/edl/<id>.tsv music/<file> auto <seconds> work/edl/<id>.beat.tsv`
   re-times the same shots onto the beat and prints `audio_start` and `video_seconds`. From here on use the
   `.beat.tsv` as the cut's EDL and `video_seconds` as its `seconds`. `auto` starts at the loudest stretch (the
   chorus or drop); give a number instead to start elsewhere.
6. **Render**: `bash $SK/render.sh footage work/edl/<id>.tsv out/previews/<id>.mp4` (the `.beat.tsv` with music).
   With music, then `bash $SK/mix.sh out/previews/<id>.mp4 music/<file> <audio_start>` (sets loudness and a short
   fade out). Read
   `out/previews/<id>.check.jpg`: every shot upright, filling the frame, not black. Then read every
   `out/previews/<id>.review-N.jpg`: five frames across each shot, one shot per row. In every row something must
   visibly happen from the first frame to the last (under the profile: the hit, the rep, the pour, the reaction);
   a row where the frames look alike, or people only walk or wait, is a wasted shot: replace it from another
   `moments.py` window, fit and render again. Do 15s first, then 30s.
   When a shot keeps its sound, `render.sh` says so and `mix.sh` lowers the music under it by itself. With no
   music but a shot that keeps its sound: `bash $SK/mix.sh out/previews/<id>.mp4 none 0`.
7. **Words**: for each cut, ~10 `hookOptions` per `hooks.md` and a `caption` per `captions.md`. Suggest `coverAt`:
   seconds into the cut of the best cover frame (the finished result, no motion blur).
8. **Review**: for each cut, ask the `reviewer` subagent to check it (one call per cut). Tell it the cut's `id`
   and paste the cut's `hookOptions` and `caption` into the message. It answers `VERDICT: pass` or a short list of
   fixes. Apply every fix (re-fit, re-render, re-mix, re-check, or rewrite the words) unless it contradicts the
   request. If it found a shot where nothing happens or a request that was not followed, ask it once more after
   fixing; two reviews at most. If the reviewer cannot be reached, carry on without it.
9. **Manifest**: write `out/manifest.json` (below). `python3 $SK/edl2json.py json work/edl/<id>.tsv` prints each
   cut's `edl` array exactly as rendered; paste it in unchanged. Then finish with one short line.

## Sound from the clips

A shot is silent under the music unless its EDL line ends in `|1`. Keep a shot's sound when:
- `listen.py` marks the clip `TALKING`, or the person says they want to hear someone ("open with him talking",
  "I can't hear her", "keep what he says"). A talking clip that is used is used for its words: take whole
  phrases by the times in `work/listen/speech.tsv` (start 0.2s before the first word, end 0.3s after the last),
  never the middle of a sentence, and let the shot run as long as the phrase needs (3 to 8 seconds is normal).
  `fit.py` and `beatfit.py` leave these shots' words whole and do not count them towards pacing.
- The person asks for the real sound of something (the hits, the crowd).
Use the strongest one or two phrases, not everything said. On a first cut, a `TALKING` clip opens the cut or
closes it unless the brief says otherwise; never drop it in as a silent one-second shot. If the words are needed
but `listen.py` found none or could not run, still keep the sound on that shot and say so in the reply.
Never tell the person the voice cannot be kept.

## Revisions

Read `previous.json`, the request and `history`. Change only what was asked; everything else stays exactly as it
was, and everything asked earlier in `history` still holds (longer shots stay long, the opener they chose stays).
- A cut that does not change: copy its manifest entry unchanged, including `preview` `{"key": ...}`.
- A cut that changes: `python3 $SK/edl2json.py tsv previous.json <id> work/edl/<id>.prev.tsv`, edit that EDL as
  asked (keep every shot the request does not touch), then fit (only if the length must change, with the same
  pace as before: `held` if the shots were long or `history` asked for it), render, check
  and review as above, and give the cut `preview` `{"path": ...}`. Keep its `id`. New words only if the request is about words.
- A new cut asked for: make it as in a first cut, with a new `id`.
- "Change the song": start from the previous EDL, pick a different track (from `music/`, or from Epidemic Sound
  per `epidemic-sound.md` when it is connected), beatfit, render, mix. "No music":
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
      "edl": [{"file": "IMG_0412.mov", "in": 3.2, "dur": 1.1, "speed": 1, "cropX": null},
              {"file": "talk.mov", "in": 0.8, "dur": 5.1, "speed": 1, "cropX": null, "sound": true}],
      "hookOptions": ["...", "..."], "caption": "...", "script": null, "coverAt": 13.5,
      "music": {"file": "03-summer-days.mp3", "start": 41.218}
    }
  ]
}
```

- `mode` is always `"music"` and `script` always `null` (no voice-over yet). `seconds` is the cut's length.
- `music`: the track's `file` and the `audio_start` the preview was mixed from, or `null` for a cut with no music.
- `"sound": true` marks a shot that keeps its clip's own sound; `edl2json.py` writes it for you.
- Ids: lowercase with dashes (`reel-15`, `reel-30`, `story-15`). Titles are plain ("Stand 30s").
- `reply`: what goes back into the conversation, in the owner's plain voice: two or three short sentences on what
  you made and any choice they might want to change (an odd clip left out, a segment with only one angle). No lists
  of files, no technical terms, no praise of your own work.
- `question`: `null`, or ONE short question when something essential is missing (see `intake.md`). With a
  question you may still deliver cuts; if you truly cannot make anything, `cuts` is `[]`.
- Keep all text plain: no markdown, no emojis except in `caption`.

## Common mistakes

- Taking a one-second slice of a pan. Use the whole pan sped up.
- Choosing a shot from a single frame on a sheet. Look at the stretch closely first (`sample.sh` with `clip|from|to`).
- Muting someone who is talking to the camera, or cutting them off mid-sentence.
- Going back to quick cuts on a later revision after the person asked for longer shots.
- Trusting a clip's reported frame rate or length without `scan.py`.
- An `edl` in the manifest that differs from the EDL the preview was rendered from. Always use `edl2json.py`.
- Inventing facts in hooks or captions. Only the brief and what the footage shows.
