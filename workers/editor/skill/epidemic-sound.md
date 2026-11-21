# Epidemic Sound (an option, only when connected)

Use this only when `job.json` has `"epidemicSound": true`: the brand has connected its own Epidemic Sound
account, so you can search that catalogue and bring a track into `music/` for this job. When it is false or
missing, the two tools below do not exist; pick from `music/` as usual and never mention Epidemic Sound.

It is an extra source, not a replacement. Tracks already in `music/` are the brand's own library and are the
default.

## When to use it

- The request or instructions ask for it: "use Epidemic Sound", "find a new song", "something we haven't used".
- The request or instructions name a mood, genre or tempo that no track in `job.json` `music` fits.
- "Change the song" on a revision, when nothing else in `music/` fits what they asked for.
- Music is wanted and `job.json` lists no tracks.

Otherwise use `music/`.

## How

1. **Search**: call `mcp__epidemic__search_music` with `term`, a few plain words for the feel
   ("upbeat tropical house", "warm acoustic morning", "driving hip hop instrumental"). Narrow with `bpmMin` /
   `bpmMax` when the pace matters, and `vocals: false` unless they asked for a song with singing. Each result has
   `id`, `title`, `artist`, `bpm`, `seconds` and `tags`. A job gets 12 searches, so make each one count: change the
   words rather than repeating a search.
2. **Choose** one track per cut by tags and tempo against the brief and the footage's pace. For 15s and 30s cuts a
   clear, steady beat matters more than anything else. The same track can serve both cuts.
3. **Download**: call `mcp__epidemic__download_track` with that `id`. It saves the track into `music/` and answers
   with its `file` (for example `music/es-summer-knot-b93f23e5.mp3`). A job gets 4 downloads: decide first,
   then download.
4. **Use it like any other track**: `python3 $SK/music.py info music/<file>` for its beat and loudest stretch,
   then `beatfit.py`, `render.sh` and `mix.sh` exactly as in SKILL.md. In the manifest the cut's `music` is
   `{"file": "<file>", "start": <audio_start>}` as usual. The track is added to the brand's library when the cut
   is delivered.
5. **Say so** in `reply`, in one plain clause: the track's title and that it came from Epidemic Sound.

## If a tool answers with an error

Try once more only if the message suggests it (a different search, for example). Otherwise fall back to a track
from `music/`, or a silent cut when there are none, and say in `reply` that Epidemic Sound was not available. Never
ask a question about it and never leave a cut unfinished because of it.
