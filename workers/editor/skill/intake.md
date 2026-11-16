# Intake (non-interactive)

Decide from `job.json` and the scan. Take anything the `request` or `instructions` say over these defaults.

1. **Project type**: build (default) or event recap, only when the request says event, recap, party, launch,
   activation day or similar, or the footage plainly shows an event with no build. Build uses `profiles/build.md`.
   For an event recap use the same rules with these differences:

   | | Build | Event recap |
   |---|---|---|
   | Order | Strictly chronological | Loose; best moments can move |
   | Hook | The finished result | The peak moment |
   | Timelapse | Heavy, it shows progress | Light, for setup and crowd |
   | Ranks highest | Visible change, the reveal | People, reactions, atmosphere |

2. **Segments**: group the footage by content and shooting order (filenames from phones usually sort by time).
   Use them for chronological order and to spread screen time; v1 makes whole-project cuts only.

3. **Lengths**: `reel` = one 15s cut and one 30s cut. `story` = one 15s cut. Other lengths or counts only when
   the request asks (at most 4 cuts, each 5 to 90 s).

4. **Mode**: music-led pacing, silent previews, no voice-over and no music (the person adds a sound in Instagram).

5. **Odd clips**: clips `scan.py` flags as horizontal or a different shape are cropped to fill (choose `crop_x` to
   keep the action in frame) when they are strong; otherwise leave them out. Say so in the reply if a strong clip
   was left out.

6. **The story, for hooks and captions**: only from `request`, `instructions`, `brand.voice` and what the footage
   shows. Missing facts are left out of the words, not invented.

## When to ask (rarely)

Return a `question` only when the cut cannot be made well without the answer, for example: the request names a
moment or product that no clip shows; or the footage is two unrelated shoots and the request does not say which.
Ask one short question with your recommendation in it ("I can only find the setup, not the opening night. Cut the
setup only?"). If you can still make a sensible cut, make it and ask in the same manifest.
A missing caption fact is never a reason to ask: write the caption without it.
