#!/usr/bin/env python3
"""usage: fit.py <footage_dir> <draft.tsv> <target_seconds> <out.tsv>
EDL line: file|in_seconds|source_seconds|speed|crop_x(optional)
Scales all sped-up shots by one factor so the cut lands exactly on the target length (with no sped-up
shots, scales the real-speed shot lengths instead), then checks every shot sits inside its clip's real
length and that no source range is reused. Exits 1 on any problem."""
import os, subprocess, sys

root, src, target, out = sys.argv[1], sys.argv[2], float(sys.argv[3]), sys.argv[4]
rows = [l.rstrip("\n").split("|") for l in open(src) if l.strip()]
if not rows: sys.exit("empty EDL")
real = sum(float(r[2]) for r in rows if float(r[3]) == 1)
fast = sum(float(r[2]) / float(r[3]) for r in rows if float(r[3]) != 1)
note = ""
if fast > 0:
    if target - real <= 0.3:
        sys.exit(f"real-speed shots alone are {real:.1f}s, too long for {target:.1f}s: shorten or speed some up")
    k = fast / (target - real)
    for r in rows:
        if float(r[3]) != 1: r[3] = f"{float(r[3]) * k:.3f}"
    note = f"speeds x{k:.2f}"
else:
    k = target / real
    for r in rows: r[2] = f"{float(r[2]) * k:.3f}"
    note = f"all real speed, lengths x{k:.2f}"

dur, bad, used = {}, [], {}
for i, r in enumerate(rows, 1):
    f, tin, sd = r[0], float(r[1]), float(r[2])
    if f not in dur:
        dur[f] = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", os.path.join(root, f)]))
    if tin < 0 or tin + sd > dur[f] - 0.05: bad.append(f"shot {i} {f}: {tin:.1f}-{tin + sd:.1f}s, clip is {dur[f]:.1f}s")
    for a, b, j in used.get(f, []):
        if tin < b and a < tin + sd: bad.append(f"shot {i} {f}: overlaps shot {j}")
    used.setdefault(f, []).append((tin, tin + sd, i))
open(out, "w").write("\n".join("|".join(r) for r in rows) + "\n")
print(f"{os.path.basename(src)}: {len(rows)} shots, real-speed {real:.1f}s, sped-up {fast:.1f}s -> {note}, problems: {bad or 'none'}")
sys.exit(1 if bad else 0)
