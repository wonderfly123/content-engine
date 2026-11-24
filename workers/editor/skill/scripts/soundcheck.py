#!/usr/bin/env python3
"""usage: soundcheck.py <preview.mp4>
Measures the sound of a mixed preview (run it after mix.sh), so a cut is never sent with sound nobody listened to:
  - loudness: how loud the whole cut is, against what phones expect, and that nothing clips;
  - voice over music: while someone is speaking, the music sits well under the voice (uses <preview>.music.wav
    and <preview>.said.wav, which mix.sh leaves when a shot keeps its own sound);
  - ending: a cut with music fades out, it does not stop dead.
Prints one line per check, `ok` or `FIX` with what to do, writes the same to <preview>.sound.txt (the reviewer
reads it), and ends with PASS or FAIL. Exit code 1 on FAIL."""
import math, os, re, subprocess, sys

import numpy as np

RATE = 16000
BLOCK = 0.2                  # seconds per measured block
LOUD_MIN, LOUD_MAX = -17.0, -11.5   # LUFS: mix.sh aims at -14 (music) / -15 (voice alone)
VOICE_ONLY_EXTRA = 2.5       # a cut with speech and no music has quiet stretches: allow it this much lower
PEAK_MAX = -0.5              # dBTP
UNDER_VOICE = 10.0           # the music is at least this many dB under the voice, typically
UNDER_VOICE_FLOOR = 5.0      # ...and hardly ever closer than this
CLOSE_SHARE = 0.15           # share of spoken blocks allowed closer than the floor
END_DROP = 8.0               # the last block of music is this many dB under the music's usual level
SILENT = -70.0


def db(x):
    return 20 * math.log10(x) if x > 1e-7 else -140.0


def blocks(path):
    """RMS in dB of each BLOCK of the file's sound (mono), or None when it has none."""
    r = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-vn", "-ac", "1", "-ar", str(RATE), "-f", "s16le", "-"],
                       capture_output=True, stdin=subprocess.DEVNULL)
    a = np.frombuffer(r.stdout, dtype=np.int16).astype(np.float64) / 32768.0
    n = int(RATE * BLOCK)
    if r.returncode != 0 or len(a) < n:
        return None
    a = a[: len(a) // n * n].reshape(-1, n)
    return [db(float(v)) for v in np.sqrt((a * a).mean(axis=1))]


def loudness(path):
    """(integrated LUFS, true peak dBTP) of the whole file."""
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", path, "-vn", "-af", "ebur128=peak=true", "-f", "null", "-"],
                       capture_output=True, text=True, stdin=subprocess.DEVNULL)
    tail = r.stderr[r.stderr.rfind("Summary:"):] if "Summary:" in r.stderr else ""
    i = re.search(r"I:\s+(-?[\d.]+) LUFS", tail)
    p = re.search(r"Peak:\s+(-?[\d.]+) dBFS", tail)
    return (float(i.group(1)) if i else None), (float(p.group(1)) if p else None)


def check(preview):
    stem = preview[: -len(".mp4")] if preview.endswith(".mp4") else preview
    music_path, said_path = stem + ".music.wav", stem + ".said.wav"
    lines, failed = [], 0

    def add(ok, text):
        nonlocal failed
        failed += 0 if ok else 1
        lines.append(("ok " if ok else "FIX ") + text)

    final = blocks(preview)
    if final is None or max(final) < SILENT:
        return ["FIX no sound in this cut -> run mix.sh on it first", "FAIL 1 sound problem"], 1

    voice_only = os.path.isfile(stem + ".voice.wav") and not os.path.isfile(music_path)
    lufs, peak = loudness(preview)
    if lufs is None:
        add(False, "loudness could not be measured -> run mix.sh again")
    else:
        low = LOUD_MIN - (VOICE_ONLY_EXTRA if voice_only else 0.0)
        add(low <= lufs <= LOUD_MAX, f"loudness {lufs:.1f} LUFS (wanted {low:g} to {LOUD_MAX:g})"
            + ("" if low <= lufs <= LOUD_MAX else " -> run mix.sh again; if it stays outside, say so in your notes"))
        if peak is not None:
            add(peak <= PEAK_MAX, f"peak {peak:.1f} dBTP (at most {PEAK_MAX:g})" + ("" if peak <= PEAK_MAX else " -> run mix.sh again"))

    music, said = (blocks(music_path), blocks(said_path)) if os.path.isfile(music_path) and os.path.isfile(said_path) else (None, None)
    if music and said:
        n = min(len(music), len(said))
        top = max(said[:n])
        spoken = [i for i in range(n) if said[i] > max(top - 20.0, -45.0)]
        if spoken:
            gaps = sorted(said[i] - music[i] for i in spoken)
            typical = gaps[len(gaps) // 2]
            close = sum(1 for g in gaps if g < UNDER_VOICE_FLOOR) / len(gaps)
            ok = typical >= UNDER_VOICE and close <= CLOSE_SHARE
            down = int(math.ceil(max(UNDER_VOICE - typical, UNDER_VOICE_FLOOR - gaps[int(len(gaps) * CLOSE_SHARE)], 3.0)))
            add(ok, f"voice over music: the music sits {typical:.0f} dB under the voice over {len(spoken) * BLOCK:.1f}s of talking"
                + ("" if ok else f" ({close:.0%} of it closer than {UNDER_VOICE_FLOOR:g} dB) -> mix again with the music {down} dB lower:"
                                 f" mix.sh <preview> <track> <audio_start> -{down}"))
        else:
            lines.append("ok no talking found in the shots that keep their sound")

    with_music = music if music else (None if voice_only else final)
    if with_music and len(with_music) >= 8:
        body = sorted(with_music[:-3])
        usual = body[len(body) * 3 // 4]     # its level where it plays in full, not where it is lowered under a voice
        last = with_music[-1]
        ok = last <= usual - END_DROP or last < -50.0
        add(ok, f"ending: the music is {usual - last:.0f} dB down in the last {BLOCK:g}s" + ("" if ok else " -> it stops dead: run mix.sh again"))

    lines.append("PASS" if failed == 0 else f"FAIL {failed} sound problem{'s' if failed != 1 else ''}")
    return lines, failed


if __name__ == "__main__":
    if len(sys.argv) != 2 or not os.path.isfile(sys.argv[1]):
        sys.exit(__doc__)
    out, bad = check(sys.argv[1])
    text = "\n".join(out)
    print(text)
    try:
        with open((sys.argv[1][: -len(".mp4")] if sys.argv[1].endswith(".mp4") else sys.argv[1]) + ".sound.txt", "w", encoding="utf-8") as fh:
            fh.write(text + "\n")
    except OSError:
        pass
    sys.exit(1 if bad else 0)
