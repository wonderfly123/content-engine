#!/usr/bin/env python3
"""usage: scan.py <footage_dir> <out_dir>
Inventory every clip (real length and frame rate, shape, flags) and tile one middle frame per clip into
a contact sheet (one sheet per 35 clips). Writes <out_dir>/inventory.tsv and sheet-N.jpg.
A clip that cannot be read is listed with the flag "unreadable" and never used."""
import collections, json, os, shutil, subprocess, sys

root, out = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2])
shutil.rmtree(out, ignore_errors=True); os.makedirs(out)
EXT = (".mov", ".mp4", ".m4v")
clips = sorted(n for n in os.listdir(root) if n.lower().endswith(EXT) and not n.startswith("."))


def probe(p):
    j = json.loads(subprocess.check_output(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
        "stream=width,height,r_frame_rate,avg_frame_rate,duration:stream_side_data=rotation:format=duration", "-of", "json", p]))
    s = j["streams"][0]
    rot = next((abs(int(d.get("rotation", 0))) for d in s.get("side_data_list", []) if "rotation" in d), 0)
    w, h = (s["height"], s["width"]) if rot in (90, 270) else (s["width"], s["height"])
    def rate(v):
        n, d = map(int, (v or "0/1").split("/")); return n / d if d else 0.0
    dur = float(s.get("duration") or j.get("format", {}).get("duration") or 0)
    return w, h, rate(s.get("r_frame_rate")), rate(s.get("avg_frame_rate")) or rate(s.get("r_frame_rate")), dur


rows = []
for f in clips:
    try:
        w, h, nominal, real, dur = probe(os.path.join(root, f))
        rows.append(dict(f=f, w=w, h=h, nominal=nominal, real=real or nominal, dur=dur, flags=[]))
    except Exception:
        rows.append(dict(f=f, w=0, h=0, nominal=0, real=0, dur=0, flags=["unreadable"]))

good = [r for r in rows if "unreadable" not in r["flags"]]
if good:
    shape = collections.Counter((r["w"], r["h"]) for r in good).most_common(1)[0][0]
    rate = collections.Counter(round(r["nominal"]) for r in good).most_common(1)[0][0]
    for r in good:
        if r["w"] > r["h"]: r["flags"].append("horizontal")
        elif (r["w"], r["h"]) != shape: r["flags"].append(f"shape {r['w']}x{r['h']}")
        if round(r["nominal"]) != rate: r["flags"].append(f"rate {r['nominal']:.0f}")
        if r["real"] and r["nominal"] / r["real"] >= 1.5: r["flags"].append(f"nominal {r['nominal']:.0f}fps but really {r['real']:.0f}")
        if r["dur"] < 1.5: r["flags"].append("under 1.5s")

with open(os.path.join(out, "inventory.tsv"), "w") as fh:
    fh.write("clip\tseconds\twidth\theight\treal_fps\tflags\n")
    for r in rows:
        fh.write(f"{r['f']}\t{r['dur']:.1f}\t{r['w']}\t{r['h']}\t{r['real']:.2f}\t{'; '.join(r['flags'])}\n")

COLS, PER_SHEET = 7, 35
for s in range(0, len(rows), PER_SHEET):
    batch, n = rows[s:s + PER_SHEET], s // PER_SHEET + 1
    tmp = os.path.join(out, "_frames"); shutil.rmtree(tmp, ignore_errors=True); os.makedirs(tmp)
    print(f"\nsheet {n}:")
    for i, r in enumerate(batch, s + 1):
        dst = os.path.join(tmp, f"{i:03d}.jpg")
        vf = "scale=180:320:force_original_aspect_ratio=decrease,pad=180:320:(ow-iw)/2:(oh-ih)/2"
        ok = r["dur"] > 0 and subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{r['dur'] / 2:.2f}", "-i", os.path.join(root, r["f"]),
                                              "-frames:v", "1", "-vf", vf, dst], stdin=subprocess.DEVNULL).returncode == 0 and os.path.exists(dst)
        if not ok:  # keep the grid aligned with the list even when a grab fails
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=black:s=180x320", "-frames:v", "1", dst], stdin=subprocess.DEVNULL)
        flags = f"  [{'; '.join(r['flags'])}]" if r["flags"] else ""
        print(f"  #{i:02d} {r['f']} {r['dur']:.0f}s{flags}")
    sheet = os.path.join(out, f"sheet-{n}.jpg")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-framerate", "1", "-pattern_type", "glob", "-i", os.path.join(tmp, "*.jpg"),
                    "-vf", f"tile={COLS}x{(len(batch) + COLS - 1) // COLS}", "-frames:v", "1", "-q:v", "4", sheet], stdin=subprocess.DEVNULL)
    shutil.rmtree(tmp)
    print(f"  {sheet} (tiles numbered left to right, top to bottom, {COLS} per row)")

flagged = [r for r in rows if r["flags"]]
print(f"\n{len(rows)} clips, {sum(r['dur'] for r in rows) / 60:.1f} min total; {len(flagged)} flagged; inventory: {os.path.join(out, 'inventory.tsv')}")
