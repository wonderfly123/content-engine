#!/usr/bin/env python3
"""usage: fit.py <footage_dir> <draft.tsv> <target_seconds> <out.tsv> [quick|held]
EDL line: file|in_seconds|source_seconds|speed|crop_x(optional)|sound(optional, 1 keeps the clip's own sound)
Scales all sped-up shots by one factor so the cut lands exactly on the target length (with no sped-up
shots, scales the real-speed shot lengths instead), then checks every shot sits inside its clip's real
length, that no source range is reused, and the pacing (enough shots for the length, mostly real speed).
A shot that keeps its sound is never scaled (words would be cut) and does not count towards pacing.
Pace `quick` (the default) is the fast montage pacing in profiles/build.md; `held` lets shots run longer,
for when the person, the brand's style or the profile asks for longer holds.
Exits 1 on any problem."""
import os, subprocess, sys

root, src, target, out = sys.argv[1], sys.argv[2], float(sys.argv[3]), sys.argv[4]
pace = sys.argv[5] if len(sys.argv) > 5 else "quick"
if pace not in ("quick", "held"): sys.exit("pace is quick or held")
rows = [l.rstrip("\n").split("|") for l in open(src) if l.strip()]
if not rows: sys.exit("empty EDL")
keeps = lambda r: len(r) > 5 and r[5].strip() == "1"
for i, r in enumerate(rows, 1):
    if keeps(r) and float(r[3]) != 1: sys.exit(f"shot {i} keeps its sound, so its speed must be 1")
voiced = sum(float(r[2]) for r in rows if keeps(r))
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
elif real - voiced > 0:
    if target - voiced <= 0.3:
        sys.exit(f"the shots that keep their sound are {voiced:.1f}s, too long for {target:.1f}s: use a shorter part of what is said")
    k = (target - voiced) / (real - voiced)
    for r in rows:
        if not keeps(r): r[2] = f"{float(r[2]) * k:.3f}"
    note = f"all real speed, lengths x{k:.2f}" + (" (shots with sound left as they are)" if voiced else "")
else:
    note = f"only shots that keep their sound, {voiced:.1f}s, left as they are"

dur, bad, used = {}, [], {}
for i, r in enumerate(rows, 1):
    f, tin, sd = r[0], float(r[1]), float(r[2])
    if f not in dur:
        dur[f] = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", os.path.join(root, f)]))
    if tin < 0 or tin + sd > dur[f] - 0.05: bad.append(f"shot {i} {f}: {tin:.1f}-{tin + sd:.1f}s, clip is {dur[f]:.1f}s")
    for a, b, j in used.get(f, []):
        if tin < b and a < tin + sd: bad.append(f"shot {i} {f}: overlaps shot {j}")
    used.setdefault(f, []).append((tin, tin + sd, i))
# Pacing (profiles/build.md, "Pacing"): average shot length by cut length, and real-speed moments must lead.
# Shots that keep their sound run as long as the words need, so they are left out of the count.
n = sum(1 for r in rows if not keeps(r))
rest = target - voiced
if pace == "held":
    max_avg = 4.0 if target <= 20 else 5.0 if target <= 35 else 6.0
else:
    max_avg = 1.6 if target <= 20 else 2.2 if target <= 35 else 3.2 if target <= 50 else 3.8
min_shots = max(1, int(rest / max_avg + 0.999))
if n and rest >= 8 and n < min_shots:
    bad.append(f"pacing: {n} shots for {rest:.0f}s averages {rest / n:.1f}s a shot; aim for {max_avg:.1f}s or less, so at least {min_shots} shots")
if pace == "held" and n and rest / n < 1.5:
    bad.append(f"pacing: {n} shots for {rest:.0f}s averages {rest / n:.1f}s a shot, which is choppy for a held cut; use fewer, longer shots")
sped = sum(1 for r in rows if float(r[3]) != 1)
if len(rows) >= 4 and sped / len(rows) > 0.7:
    bad.append(f"pacing: {sped} of {len(rows)} shots are sped up; most shots should be real-speed moments, with speed-ups only for pans and long takes")
open(out, "w").write("\n".join("|".join(r) for r in rows) + "\n")
print(f"{os.path.basename(src)}: {len(rows)} shots ({pace}), real-speed {real:.1f}s ({voiced:.1f}s with sound), sped-up {fast:.1f}s -> {note}, problems: {bad or 'none'}")
sys.exit(1 if bad else 0)
