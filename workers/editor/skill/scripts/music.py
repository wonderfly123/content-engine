#!/usr/bin/env python3
"""Music tools (cloud copy of the owner's music.py). Needs ffmpeg and numpy.

  music.py info <track>                      tempo, first beat, beat strength and loudest 15 s of one track (JSON)
  music.py beats <track> [start] [seconds]   print beat times (seconds) for a stretch of a track

Tempo can be off by half or double time when the beat strength is low (under ~2)."""
import json, subprocess, sys
import numpy as np

SR = 11025


def load(path, start=None, dur=None):
    cmd = ["ffmpeg", "-v", "error"] + (["-ss", str(start)] if start else []) + (["-t", str(dur)] if dur else []) + \
          ["-i", path, "-ac", "1", "-ar", str(SR), "-f", "s16le", "-"]
    return np.frombuffer(subprocess.check_output(cmd), dtype=np.int16).astype(np.float32) / 32768


def spec(x, n=1024, h=256):
    if len(x) < n:
        x = np.pad(x, (0, n - len(x)))
    nfr = max(1, (len(x) - n) // h); win = np.hanning(n).astype(np.float32); out = []
    idx = np.arange(n)[None, :] + h * np.arange(nfr)[:, None]
    for s in range(0, nfr, 4000):
        out.append(np.abs(np.fft.rfft(x[idx[s:s + 4000]] * win, axis=1)))
    return np.vstack(out), SR / h


def tempo(x):
    """(bpm, first_beat_seconds, strength). Octave errors (half/double time) are possible."""
    S, fps = spec(x)
    flux = np.maximum(np.diff(np.log1p(50 * S), axis=0), 0).sum(1)
    if len(flux) < 2:
        return 0.0, 0.0, 0.0
    flux = flux - np.convolve(flux, np.ones(int(fps)) / int(fps), mode="same"); flux = np.maximum(flux, 0)
    if flux.sum() == 0:
        return 0.0, 0.0, 0.0
    ac = np.correlate(flux, flux, mode="full")[len(flux) - 1:]
    best, score = 0, -1
    for bpm in np.arange(70, 180.01, 0.25):
        lag = 60 / bpm * fps
        v = sum(np.interp(lag * k, np.arange(len(ac)), ac) / k for k in (1, 2, 3, 4) if lag * k < len(ac) - 1)
        if v > score:
            best, score = bpm, v
    period = 60 / best * fps
    phases = np.arange(0, period, 0.5)
    idx = lambda ph: np.round(np.arange(ph, len(flux) - 1, period)).astype(int)
    ph = max(phases, key=lambda p: flux[idx(p)].sum())
    strength = float(flux[idx(ph)].mean() / (flux.mean() + 1e-9))
    return float(best), float(ph / fps), strength


def loudest(x, seconds=15):
    """Start (whole seconds) of the loudest `seconds` stretch: likely the hook, chorus or drop."""
    w = int(seconds * SR)
    e = [float((x[i:i + w] ** 2).mean()) for i in range(0, max(1, len(x) - w), SR)]
    return int(np.argmax(e)) if e else 0


def duration(path):
    return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path]))


def info(path):
    x = load(path)
    bpm, first, strength = tempo(x)
    return {"seconds": round(len(x) / SR, 1), "bpm": round(bpm, 2), "firstBeat": round(first, 3),
            "beatStrength": round(strength, 2), "loudestFrom": loudest(x)}


if __name__ == "__main__":
    a = sys.argv[1:]
    if len(a) == 2 and a[0] == "info":
        print(json.dumps(info(a[1])))
    elif len(a) >= 2 and a[0] == "beats":
        start = float(a[2]) if len(a) > 2 else 0.0; dur = float(a[3]) if len(a) > 3 else None
        bpm, first, strength = tempo(load(a[1], start, dur))
        if bpm <= 0:
            sys.exit("no beat found")
        n = int(((dur or duration(a[1]) - start) - first) / (60 / bpm)) + 1
        print(f"bpm {bpm:.2f} strength {strength:.2f}"); print(" ".join(f"{first + k * 60 / bpm:.3f}" for k in range(n)))
    else:
        print(__doc__); sys.exit(1)
