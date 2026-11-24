#!/usr/bin/env python3
"""usage: check_footage.py <folder of real clips> [--keep]

The standing check for pipeline changes: runs the editor's own prepare-and-render steps on real
footage (no agent, no network, no cost) and fails loudly if anything a real edit depends on breaks.

For every clip in the folder it makes working copies exactly as a job does (prepare.py), then renders
a cut that takes three shots from each clip with the job's render.sh, and checks:
  - every heavy clip got a small standard-range copy and kept its original;
  - working copies took less time than the footage runs (so a job's budget holds);
  - the cut is 1080x1920, standard range, the right length, and rendered inside five minutes;
  - no frame the agent would be shown is anywhere near the size that once crashed a run.

The clips are hard-linked into a scratch folder next to them, so nothing in the folder is changed.
Keep a few real clips there, including a long 4K one, and run this before a change to upload,
shrinking or editing goes live.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import prepare  # noqa: E402

SCRIPTS = os.path.join(HERE, "skill", "scripts")
EXT = (".mov", ".mp4", ".m4v")
SHOT_SEC = 1.5
RENDER_MAX_SEC = 5 * 60
# A frame handed to the agent as base64 must stay far below the CLI's message limit.
FRAME_MAX_BYTES = 400 * 1024


def video(path: str) -> dict:
    out = subprocess.check_output(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                                   "stream=width,height,color_transfer,pix_fmt:format=duration", "-of", "json", path])
    j = json.loads(out)
    return dict(j["streams"][0], seconds=float(j["format"]["duration"]))


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    keep = "--keep" in sys.argv
    if len(args) != 1 or not os.path.isdir(args[0]):
        print(__doc__)
        return 2
    source = os.path.abspath(args[0])
    names = sorted(n for n in os.listdir(source) if n.lower().endswith(EXT) and not n.startswith("."))
    if not names:
        print(f"FAIL no clips in {source}")
        return 1

    problems: list[str] = []
    ws = tempfile.mkdtemp(prefix=".check-", dir=os.path.dirname(source))
    try:
        footage, work, out_dir = (os.path.join(ws, d) for d in ("footage", "work", "out"))
        for d in (footage, work, out_dir):
            os.makedirs(d)
        total_bytes = 0
        for n in names:
            src = os.path.join(source, n)
            total_bytes += os.path.getsize(src)
            try:
                os.link(src, os.path.join(footage, n))
            except OSError:
                shutil.copy2(src, os.path.join(footage, n))
        before = {n: prepare.probe(os.path.join(footage, n)) for n in names}
        footage_sec = sum((i or {}).get("seconds", 0) for i in before.values())
        print(f"{len(names)} clips, {total_bytes / 1024 ** 2:.0f} MB, {footage_sec / 60:.1f} min of footage")
        for n in names:
            i = before[n]
            if i is None:
                problems.append(f"{n} cannot be read")
                continue
            print(f"  {n}: {i['width']}x{i['height']} {i['bitRate'] / 1e6:.0f} Mbit/s {'HDR ' if i['hdr'] else ''}{i['seconds']:.0f}s"
                  f"{' -> needs a working copy' if prepare.is_heavy(i) else ''}")

        done = prepare.make_working_copies(ws, names, 60 * 60, lambda m: print(f"  ! {m}"))
        heavy = [n for n in names if before[n] and prepare.is_heavy(before[n])]
        print(f"working copies: {done['made']} made, {done['kept']} used as they are, {done['seconds']}s")
        if done["made"] != len(heavy):
            problems.append(f"{len(heavy)} clips needed a working copy but {done['made']} were made")
        if heavy and done["seconds"] > footage_sec:
            problems.append(f"working copies took {done['seconds']}s for {footage_sec:.0f}s of footage (slower than real time)")
        for n in heavy:
            copy, original = os.path.join(footage, n), os.path.join(ws, prepare.ORIGINALS, n)
            if not os.path.isfile(original):
                problems.append(f"{n}: the original was not kept")
                continue
            v = video(copy)
            if min(int(v["width"]), int(v["height"])) != prepare.SHORT_SIDE or v.get("color_transfer") in prepare.HDR_TRANSFERS:
                problems.append(f"{n}: working copy is {v['width']}x{v['height']} {v.get('color_transfer')}")
            if abs(v["seconds"] - before[n]["seconds"]) > 0.5:
                problems.append(f"{n}: working copy runs {v['seconds']:.1f}s, the original {before[n]['seconds']:.1f}s")
            # A frame the agent would look at, taken the way the skill's scripts take one.
            frame = os.path.join(work, f"{os.path.splitext(n)[0]}.jpg")
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{v['seconds'] / 2:.2f}", "-i", copy, "-frames:v", "1", frame],
                           stdin=subprocess.DEVNULL, check=False)
            if not os.path.isfile(frame) or os.path.getsize(frame) > FRAME_MAX_BYTES:
                problems.append(f"{n}: a full frame of the working copy is {os.path.getsize(frame) // 1024 if os.path.isfile(frame) else 0} KB")

        shots = 0
        with open(os.path.join(work, "cut.tsv"), "w") as f:
            for n in names:
                i = before[n]
                if i is None or i["seconds"] < SHOT_SEC + 1:
                    continue
                for at in (0.1, 0.5, 0.85):
                    f.write(f"{n}|{max(0.0, i['seconds'] * at - SHOT_SEC / 2):.2f}|{SHOT_SEC}|1\n")
                    shots += 1
        out = os.path.join(out_dir, "cut.mp4")
        started = time.monotonic()
        r = subprocess.run(["bash", os.path.join(SCRIPTS, "render.sh"), footage, os.path.join(work, "cut.tsv"), out],
                           capture_output=True, text=True, stdin=subprocess.DEVNULL)
        render_sec = time.monotonic() - started
        print(f"render: {shots} shots in {render_sec:.0f}s ({(r.stdout.strip().splitlines() or [''])[-1]})")
        if r.returncode != 0 or not os.path.isfile(out):
            problems.append(f"render.sh failed: {(r.stdout + r.stderr).strip()[-300:]}")
        else:
            v = video(out)
            if (int(v["width"]), int(v["height"])) != (1080, 1920):
                problems.append(f"the cut is {v['width']}x{v['height']}")
            if v.get("color_transfer") in prepare.HDR_TRANSFERS:
                problems.append("the cut is still HDR")
            if abs(v["seconds"] - shots * SHOT_SEC) > 0.5:
                problems.append(f"the cut runs {v['seconds']:.1f}s, expected {shots * SHOT_SEC:.1f}s")
            if render_sec > RENDER_MAX_SEC:
                problems.append(f"rendering took {render_sec:.0f}s")
            if keep:
                kept = os.path.join(os.path.dirname(source), "last-check.mp4")
                shutil.copy2(out, kept)
                print(f"kept the cut: {kept}")
    finally:
        shutil.rmtree(ws, ignore_errors=True)

    for p in problems:
        print(f"FAIL {p}")
    print("PASS" if not problems else f"{len(problems)} problem(s)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
