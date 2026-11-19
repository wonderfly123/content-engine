#!/usr/bin/env python3
"""usage: beatfit.py <footage_dir> <edl.tsv> <track> <start_seconds|auto> <target_seconds> <out.tsv>
Re-time a cut so every cut lands on a beat of the track (cloud copy of the owner's beatfit.py).
Shot order and source ranges stay the same; each shot becomes a whole number of beats (the first at
least two). Prints `audio_start` (where the track starts under the video, on a beat) and
`video_seconds` (the cut's new exact length: use it as the cut's `seconds`).
'auto' starts at the track's loudest 15 seconds. Cut times are rounded to 30 fps frames cumulatively,
so the cuts never drift off the beat."""
import os, subprocess, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

FPS = 30


def allocate_beats(want, p, target):
    """Whole beats per shot (first shot >= 2, others >= 1), summing to round(target / p) where possible."""
    N = max(1, round(target / p))
    n = [max(2 if i == 0 else 1, round(d / p)) for i, d in enumerate(want)]
    while sum(n) != N:
        if sum(n) > N:
            c = [i for i in range(len(n)) if n[i] > (2 if i == 0 else 1)]
            if not c:
                break
            i = max(c, key=lambda i: n[i] * p - want[i]); n[i] -= 1
        else:
            i = max(range(len(n)), key=lambda i: want[i] - n[i] * p); n[i] += 1
    return n


def retime(rows, n, p, clip_seconds):
    """Rows [file, in, srcdur, speed(, cropx)] re-timed to n[i] beats of p seconds each, on 30 fps frames.
    Real-speed shots change their source length (sliding back if the clip ends); sped-up shots change speed.
    Returns (rows, total_seconds, problems)."""
    out, problems = [], []
    t, frame_prev = 0.0, 0
    for i, r in enumerate(rows):
        r = list(r)
        t += n[i] * p; fr = round(t * FPS); d = (fr - frame_prev) / FPS; frame_prev = fr
        f, tin, sd, sp = r[0], float(r[1]), float(r[2]), float(r[3])
        if sp == 1:
            total = clip_seconds(f)
            if tin + d > total - 0.05:
                tin = max(0.0, total - 0.05 - d); r[1] = f"{tin:.3f}"
                if tin + d > total:
                    problems.append(f"shot {i + 1} needs {d:.2f}s but {f} is {total:.2f}s")
            r[2] = f"{d:.4f}"
        else:
            r[3] = f"{sd / d:.4f}"
        out.append(r)
    return out, frame_prev / FPS, problems


def beat_start(start, lead, first, p):
    """The beat nearest the requested start, given the first beat `first` found in audio loaded from start - lead."""
    k = round((lead - first) / p)
    return max(0.0, start - lead + first + k * p)


def main(argv):
    from music import load, loudest, tempo
    footage, edl, track, start, target, out = argv[:6]
    target = float(target)
    rows = [l.rstrip("\n").split("|") for l in open(edl) if l.strip()]
    if not rows:
        sys.exit("empty EDL")
    start = float(loudest(load(track))) if start == "auto" else float(start)
    lead = min(2.0, start)                       # analyse a little before the start for a stable grid
    bpm, first, strength = tempo(load(track, start - lead, target + lead + 4))
    if bpm <= 0:
        sys.exit(f"no beat found in {os.path.basename(track)} from {start:.1f}s: pick another track or start")
    p = 60 / bpm
    a0 = beat_start(start, lead, first, p)
    n = allocate_beats([float(r[2]) / float(r[3]) for r in rows], p, target)
    cache = {}

    def clip_seconds(f):
        if f not in cache:
            cache[f] = float(subprocess.check_output(
                ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", os.path.join(footage, f)]))
        return cache[f]

    rows, total, problems = retime(rows, n, p, clip_seconds)
    with open(out, "w") as fh:
        fh.write("\n".join("|".join(r) for r in rows) + "\n")
    print(f"track {os.path.basename(track)}: {bpm:.1f} bpm (beat strength {strength:.1f}), beat every {p:.3f}s")
    print(f"audio_start={a0:.3f} video_seconds={total:.3f} shots={len(rows)} beats_per_shot={' '.join(map(str, n))}")
    if problems:
        print("PROBLEMS:", problems)
        sys.exit(1)


if __name__ == "__main__":
    if len(sys.argv) != 7:
        print(__doc__)
        sys.exit(1)
    main(sys.argv[1:])
