#!/usr/bin/env python3
"""usage: speechcheck.py <edl.tsv> <listen_dir>
Checks every shot that keeps its own sound (EDL line ending in |1) against what is said in the clip, so nobody is
cut off: the shot must not start or end inside a word, must leave a little room before the first word and after
the last, and must not start or stop in the middle of a sentence. Uses <listen_dir>/words.tsv (one line per word,
from listen.py); without it, the phrases in <listen_dir>/speech.tsv.
Prints one line per talking shot, `ok` or `FIX` with the corrected EDL line to use instead, writes the same to
<edl>.speech.txt (the reviewer reads it), and ends with PASS or FAIL. Exit code 1 on FAIL.
With neither file there, a shot that keeps its sound FAILS: nothing was checked, so run listen.py first.
A FIX is not a matter of taste: put the corrected line in the EDL, fit and render again, and run this again."""
import os, sys

LEAD = 0.2          # room before the first word
TAIL = 0.3          # room after the last word
TIGHT_LEAD = 0.08   # less room than this before the first word clips its attack
TIGHT_TAIL = 0.1
INSIDE = 0.04       # a cut this far inside a word is inside it (word times are good to a few hundredths)
PAUSE = 0.3         # a gap this long between words is a place to cut
ENDERS = (".", "?", "!", "…")


def read_tsv(path):
    rows = {}
    if not os.path.isfile(path):
        return rows
    with open(path, encoding="utf-8") as fh:
        for i, line in enumerate(fh):
            p = line.rstrip("\n").split("\t")
            if i == 0 or len(p) < 4:
                continue
            try:
                rows.setdefault(p[0], []).append((float(p[1]), float(p[2]), p[3].strip()))
            except ValueError:
                continue
    for clip in rows:
        rows[clip].sort()
    return rows


def read_edl(path):
    shots = []
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            p = line.rstrip("\n").split("|")
            if len(p) < 4 or not p[0]:
                continue
            p += [""] * (6 - len(p))
            try:
                shots.append({"file": p[0], "in": float(p[1]), "dur": float(p[2]), "speed": p[3], "crop": p[4], "sound": p[5].strip() == "1"})
            except ValueError:
                continue
    return shots


def ends_sentence(word):
    return word.rstrip('"\')”’').endswith(ENDERS)


def check_shot(shot, units, phrases=None):
    """(problems, corrected in, corrected dur). `units` are the clip's words, sorted by start, and `phrases` the
    clip's phrases (their edges are places a sentence may be cut); with no words, pass the phrases as `units`."""
    a, b = shot["in"], shot["in"] + shot["dur"]
    inside = [i for i, (s, e, _) in enumerate(units) if e > a + INSIDE and s < b - INSIDE]
    if not inside:
        return (["no speech found in this shot: check its times against the clip"] if units else []), a, shot["dur"]
    starts = None if phrases is None else [p[0] for p in phrases]
    ends = None if phrases is None else [p[1] for p in phrases]
    near = lambda t, marks: any(abs(t - m) <= 0.15 for m in marks)  # noqa: E731

    def opens(k):   # a sentence may start at word k
        return k == 0 or starts is None or near(units[k][0], starts) or ends_sentence(units[k - 1][2]) or units[k][0] - units[k - 1][1] >= PAUSE

    def closes(k):  # a sentence may end after word k
        return k == len(units) - 1 or ends is None or near(units[k][1], ends) or ends_sentence(units[k][2]) or units[k + 1][0] - units[k][1] >= PAUSE

    gap_before = lambda k: units[k][0] - (units[k - 1][1] if k > 0 else 0.0)                      # noqa: E731
    gap_after = lambda k: (units[k + 1][0] - units[k][1]) if k < len(units) - 1 else 10.0        # noqa: E731
    problems, new_a, new_b = [], a, b
    first, last = inside[0], inside[-1]

    # Where it starts.
    s, e, text = units[first]
    k = first
    if s < a - INSIDE:
        if closes(first) and first < last and (e - a) < (e - s) / 2:
            problems.append(f"starts on the tail of \"{text}\"")     # only the end of the previous sentence's last word
            k = first + 1
        else:
            problems.append(f"starts inside \"{text}\"")
    elif s - a < min(TIGHT_LEAD, gap_before(first) / 2) - 0.005:
        problems.append(f"starts too tight on \"{text}\"")
    if k == first:
        while not opens(k):
            k -= 1
        if k < first and s >= a - INSIDE:
            problems.append(f"starts mid-sentence, after \"{units[first - 1][2]}\"")
    if problems:
        new_a = max(0.0, units[k][0] - min(LEAD, gap_before(k) / 2))

    # Where it ends.
    count = len(problems)
    s, e, text = units[last]
    k = last
    if e > b + INSIDE:
        if opens(last) and last > first and (b - s) < (e - s) / 2:
            problems.append(f"catches the start of \"{text}\"")     # only the first sound of the next sentence
            k = last - 1
        else:
            problems.append(f"cuts off \"{text}\"")
    elif b - e < min(TIGHT_TAIL, gap_after(last) / 2) - 0.005:
        problems.append(f"ends too tight on \"{text}\"")
    if k == last:
        while not closes(k):
            k += 1
        if k > last and e <= b + INSIDE:
            problems.append(f"ends mid-sentence, before \"{units[last + 1][2]}\"")
    if len(problems) > count:
        new_b = units[k][1] + min(TAIL, gap_after(k) / 2)
    return problems, new_a, max(0.2, new_b - new_a)


def check(edl_path, listen_dir):
    words = read_tsv(os.path.join(listen_dir, "words.tsv"))
    phrases = read_tsv(os.path.join(listen_dir, "speech.tsv"))
    # listen.py writes both files even when it hears nothing; neither one there means nobody listened.
    listened = any(os.path.isfile(os.path.join(listen_dir, f)) for f in ("words.tsv", "speech.tsv"))
    lines, failed = [], 0
    for n, shot in enumerate(read_edl(edl_path), 1):
        if not shot["sound"]:
            continue
        if not listened:
            failed += 1
            lines.append(f"shot {n} {shot['file']} {shot['in']:.2f}-{shot['in'] + shot['dur']:.2f}: FIX not checked, the clips have no transcript")
            continue
        clip_phrases = phrases.get(shot["file"], [])
        if words.get(shot["file"]):
            problems, new_in, new_dur = check_shot(shot, words[shot["file"]], clip_phrases or None)
        else:
            problems, new_in, new_dur = check_shot(shot, clip_phrases, None)
        if not problems:
            lines.append(f"shot {n} {shot['file']} {shot['in']:.2f}-{shot['in'] + shot['dur']:.2f}: ok")
            continue
        failed += 1
        fixed = f"{shot['file']}|{new_in:.2f}|{new_dur:.2f}|{shot['speed']}|{shot['crop']}|1"
        lines.append(f"shot {n} {shot['file']} {shot['in']:.2f}-{shot['in'] + shot['dur']:.2f}: FIX {'; '.join(problems)} -> use: {fixed}")
    if not lines:
        lines.append("no shot keeps its own sound")
    if failed and not listened:
        lines.append(f"FAIL no transcript in {listen_dir} -> run listen.py on the footage first, then this again")
    else:
        lines.append("PASS" if failed == 0 else f"FAIL {failed} talking shot{'s' if failed != 1 else ''} cut into speech")
    return lines, failed


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    out, bad = check(sys.argv[1], sys.argv[2])
    text = "\n".join(out)
    print(text)
    try:
        with open(os.path.splitext(sys.argv[1])[0] + ".speech.txt", "w", encoding="utf-8") as fh:
            fh.write(text + "\n")
    except OSError:
        pass
    sys.exit(1 if bad else 0)
