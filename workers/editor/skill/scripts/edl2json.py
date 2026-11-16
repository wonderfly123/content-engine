#!/usr/bin/env python3
"""Convert between an EDL file and the manifest's `edl` array.

  edl2json.py json <edl.tsv>                      prints the JSON array for a cut's "edl" in out/manifest.json
  edl2json.py tsv <previous.json> <cut_id> <out>  writes a previous cut's EDL as a .tsv to start a revision from

EDL line: file|in_seconds|source_seconds|speed|crop_x(optional)
JSON entry: {"file", "in", "dur", "speed", "cropX"}"""
import json, sys


def to_json(path):
    out = []
    for line in open(path):
        if not line.strip():
            continue
        p = line.rstrip("\n").split("|")
        out.append({"file": p[0], "in": round(float(p[1]), 3), "dur": round(float(p[2]), 3), "speed": round(float(p[3]), 3),
                    "cropX": round(float(p[4]), 3) if len(p) > 4 and p[4].strip() else None})
    print(json.dumps(out))


def to_tsv(prev, cut_id, out):
    cut = next((c for c in json.load(open(prev))["cuts"] if c["id"] == cut_id), None)
    if cut is None:
        sys.exit(f"no cut {cut_id} in {prev}")
    lines = []
    for e in cut["edl"]:
        if not e.get("file"):
            sys.exit("an EDL entry has no footage file (its clip is not in this job)")
        crop = "" if e.get("cropX") is None else f"|{e['cropX']}"
        lines.append(f"{e['file']}|{e['in']}|{e['dur']}|{e['speed']}{crop}")
    open(out, "w").write("\n".join(lines) + "\n")
    print(f"{out}: {len(lines)} shots")


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "json":
        to_json(sys.argv[2])
    elif len(sys.argv) == 5 and sys.argv[1] == "tsv":
        to_tsv(*sys.argv[2:])
    else:
        sys.exit(__doc__)
