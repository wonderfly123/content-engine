#!/usr/bin/env python3
"""usage: listen.py <footage_dir> <out_dir>
Listens to every clip: which ones have someone talking, what they say and when. Writes <out_dir>/speech.tsv
(clip, start, end, text; one line per spoken phrase), <out_dir>/words.tsv (clip, start, end, word; one line per
word, which speechcheck.py uses to make sure no shot cuts into a word) and prints a summary per clip. A clip with no line has
no speech worth keeping (it may still have room sound). Shortest clips first; stops starting new clips after
LIMIT_SEC and lists the ones it did not reach. Never fails the job: a clip it cannot read is skipped."""
import json, os, shutil, subprocess, sys, time

LIMIT_SEC = 300
MODEL = os.environ.get("NEKTER_WHISPER_MODEL", "small")
MODEL_DIR = os.environ.get("NEKTER_WHISPER_DIR", "/opt/nekter/whisper")
EXT = (".mov", ".mp4", ".m4v")


def probe(path):
    """(seconds, has an audio stream)."""
    try:
        j = json.loads(subprocess.check_output(
            ["ffprobe", "-v", "error", "-show_entries", "stream=codec_type:format=duration", "-of", "json", path], stdin=subprocess.DEVNULL))
        return float((j.get("format") or {}).get("duration") or 0), any(s.get("codec_type") == "audio" for s in j.get("streams") or [])
    except Exception:
        return 0.0, False


def samples(path):
    """The clip's sound as the model wants it (mono, 16 kHz, floats), decoded by ffmpeg."""
    import numpy as np
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-vn", "-map", "0:a:0", "-ac", "1", "-ar", "16000", "-f", "s16le", "-"],
                         stdin=subprocess.DEVNULL, capture_output=True, check=True).stdout
    return np.frombuffer(raw[: len(raw) // 2 * 2], dtype=np.int16).astype(np.float32) / 32768


def keep(seg):
    """Drops what the model makes up over music and room noise."""
    text = seg.text.strip()
    if len(text) < 2 or seg.no_speech_prob > 0.6 or seg.avg_logprob < -1.0 or seg.compression_ratio > 2.4:
        return None
    return text.replace("\t", " ").replace("\n", " ")


def main(root, out):
    shutil.rmtree(out, ignore_errors=True); os.makedirs(out)
    clips = sorted(n for n in os.listdir(root) if n.lower().endswith(EXT) and not n.startswith("."))
    info = {f: probe(os.path.join(root, f)) for f in clips}
    tsv = os.path.join(out, "speech.tsv")
    with open(tsv, "w") as fh:
        fh.write("clip\tstart\tend\ttext\n")
    words_tsv = os.path.join(out, "words.tsv")
    with open(words_tsv, "w") as fh:
        fh.write("clip\tstart\tend\tword\n")
    try:
        from faster_whisper import WhisperModel
        local = os.path.isdir(MODEL_DIR)
        model = WhisperModel(MODEL, device="cpu", compute_type="int8", cpu_threads=min(8, os.cpu_count() or 4),
                             download_root=MODEL_DIR if local else None, local_files_only=local)
    except Exception as err:
        print(f"listening is not available here ({type(err).__name__}): treat every clip as having no usable speech")
        return
    started, skipped, talking = time.monotonic(), [], 0
    for f in sorted(clips, key=lambda f: info[f][0]):
        dur, audio = info[f]
        if not audio or dur <= 0:
            print(f"{f} {dur:.0f}s: no sound")
            continue
        if time.monotonic() - started > LIMIT_SEC:
            skipped.append(f)
            continue
        try:
            segments, _ = model.transcribe(samples(os.path.join(root, f)), beam_size=1, vad_filter=True,
                                           vad_parameters={"min_silence_duration_ms": 400}, condition_on_previous_text=False,
                                           word_timestamps=True)
            kept = [(s, t) for s in segments if (t := keep(s))]
            lines = [(s.start, s.end, t) for s, t in kept]
            words = [(w.start, w.end, w.word.strip().replace("\t", " ")) for s, _ in kept for w in (getattr(s, "words", None) or [])
                     if w.word.strip() and w.end > w.start]
        except Exception as err:
            print(f"{f} {dur:.0f}s: could not be listened to ({type(err).__name__})")
            continue
        spoken = sum(e - s for s, e, _ in lines)
        if not lines:
            print(f"{f} {dur:.0f}s: no speech")
            continue
        talking += 1
        with open(tsv, "a") as fh:
            for s, e, t in lines:
                fh.write(f"{f}\t{s:.2f}\t{e:.2f}\t{t}\n")
        with open(words_tsv, "a") as fh:
            for s, e, t in words:
                fh.write(f"{f}\t{s:.2f}\t{e:.2f}\t{t}\n")
        kind = "TALKING" if spoken >= max(2.0, 0.3 * dur) else "some speech"
        print(f"{f} {dur:.0f}s: {kind}, {spoken:.0f}s spoken")
        for s, e, t in lines[:40]:
            print(f"    {s:6.1f}-{e:6.1f}  {t}")
        if len(lines) > 40:
            print(f"    ... {len(lines) - 40} more lines in {tsv}")
    if skipped:
        print(f"not listened to (out of time): {', '.join(skipped)}")
    print(f"\n{talking} of {len(clips)} clips have speech; phrases with times: {tsv}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2]))
