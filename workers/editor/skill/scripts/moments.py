#!/usr/bin/env python3
"""usage: moments.py <footage_dir> <out_dir> [clip ...]
Finds where the action is inside long clips, so shots are taken from the lively stretches (a kick landing, a
rep, a burst of movement) and not from the quiet ones (walking, resetting, standing around).
For every clip of 8s or more (or only the clips named) it measures, second by second, how much the picture
moves and how hard the sound hits, then prints the strongest windows per clip, strongest first, and the
quietest stretches to avoid. Writes <out_dir>/moments.tsv (clip, start, end, score, motion, impact).
Scores are relative to the same clip (1.0 = that clip's average second): compare windows inside a clip, not
across clips. They say where to look, not what happens: always look at a window (sample.sh clip|from|to)
before using it. Stops starting new clips after LIMIT_SEC and lists the ones it did not reach."""
import os, shutil, subprocess, sys, time

import numpy as np

LIMIT_SEC = 240
FPS, W, H = 6, 48, 86          # small grey frames: enough to see limbs move, cheap to decode
SR = 8000
WINDOW = 3                     # seconds per window
EXT = (".mov", ".mp4", ".m4v")


def duration(path):
    try:
        return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
                                             stdin=subprocess.DEVNULL))
    except Exception:
        return 0.0


def motion_per_second(path):
    """Mean frame-to-frame change per second, with whole-frame change (camera moves, exposure) taken out."""
    cmd = ["ffmpeg", "-v", "error", "-i", path, "-an", "-vf", f"fps={FPS},scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},format=gray",
           "-f", "rawvideo", "-"]
    raw = subprocess.run(cmd, stdin=subprocess.DEVNULL, capture_output=True).stdout
    n = len(raw) // (W * H)
    if n < FPS * 2:
        return np.zeros(0)
    fr = np.frombuffer(raw[: n * W * H], dtype=np.uint8).reshape(n, H, W).astype(np.float32)
    d = np.abs(np.diff(fr, axis=0))
    d = np.clip(d - np.median(d, axis=(1, 2), keepdims=True), 0, None)   # a pan or exposure shift moves every pixel
    per_frame = d.mean(axis=(1, 2))
    secs = len(per_frame) // FPS
    return per_frame[: secs * FPS].reshape(secs, FPS).mean(axis=1)


def impact_per_second(path):
    """How sharply the sound jumps each second (a pad hit, a slam, a cheer): loudest tenth over the quiet floor."""
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-vn", "-ac", "1", "-ar", str(SR), "-f", "s16le", "-"],
                         stdin=subprocess.DEVNULL, capture_output=True).stdout
    x = np.frombuffer(raw[: len(raw) // 2 * 2], dtype=np.int16).astype(np.float32) / 32768
    hop = SR // 10
    n = len(x) // hop
    if n < 20:
        return np.zeros(0)
    rms = np.sqrt((x[: n * hop].reshape(n, hop) ** 2).mean(axis=1) + 1e-9)
    floor = np.median(rms) + 1e-4
    secs = n // 10
    return (rms[: secs * 10].reshape(secs, 10).max(axis=1) / floor)


def relative(v):
    m = float(v.mean()) if len(v) else 0.0
    return v / m if m > 1e-6 else np.zeros_like(v)


def windows(score, k, lowest=False):
    """The k best (or worst) non-overlapping WINDOW-second windows: [(start, mean score)]."""
    if len(score) < WINDOW:
        return []
    means = np.convolve(score, np.ones(WINDOW) / WINDOW, mode="valid")
    order = np.argsort(means if lowest else -means)
    picked = []
    for i in order:
        if all(abs(int(i) - s) >= WINDOW + 1 for s, _ in picked):
            picked.append((int(i), float(means[i])))
        if len(picked) == k:
            break
    return picked


def main(root, out, only):
    shutil.rmtree(out, ignore_errors=True); os.makedirs(out)
    clips = sorted(n for n in os.listdir(root) if n.lower().endswith(EXT) and not n.startswith("."))
    if only:
        clips = [c for c in clips if c in only]
    tsv = os.path.join(out, "moments.tsv")
    fh = open(tsv, "w")
    fh.write("clip\tstart\tend\tscore\tmotion\timpact\n")
    started, skipped = time.monotonic(), []
    for f in sorted(clips, key=lambda f: -duration(os.path.join(root, f))):
        path = os.path.join(root, f)
        dur = duration(path)
        if dur < 8 and not only:
            continue
        if time.monotonic() - started > LIMIT_SEC:
            skipped.append(f)
            continue
        try:
            mo, im = relative(motion_per_second(path)), relative(impact_per_second(path))
        except Exception as err:
            print(f"{f}: could not be measured ({type(err).__name__})")
            continue
        if not len(mo):
            print(f"{f}: could not be measured")
            continue
        n = len(mo)
        im = np.pad(im, (0, max(0, n - len(im))))[:n] if len(im) else np.zeros(n)
        score = (0.65 * mo + 0.35 * im) if im.any() else mo
        k = max(3, min(12, n // 15))
        best, worst = windows(score, k), windows(score, max(2, k // 3), lowest=True)
        spread = float(np.percentile(score, 90) / max(np.percentile(score, 10), 1e-3))
        note = "" if spread >= 2 else "  (even all the way through: no clear peaks, judge by eye)"
        print(f"\n{f} {dur:.0f}s{note}\n  strongest windows:")
        for s, v in best:
            w = slice(s, s + WINDOW)
            print(f"    {s:4d}-{s + WINDOW:<4d}s  score {v:4.1f}  (motion {mo[w].mean():.1f}, sound hits {im[w].mean():.1f})")
            fh.write(f"{f}\t{s}\t{s + WINDOW}\t{v:.2f}\t{mo[w].mean():.2f}\t{im[w].mean():.2f}\n")
        print("  quietest (avoid): " + ", ".join(f"{s}-{s + WINDOW}s ({v:.1f})" for s, v in sorted(worst)))
    fh.close()
    if skipped:
        print(f"\nnot measured (out of time): {', '.join(skipped)}")
    print(f"\nwindows: {tsv}. Look at a window before using it: printf '%s\\n' 'clip.mov|12|15' | bash sample.sh footage work/samples/zoom")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    main(os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2]), set(sys.argv[3:]))
