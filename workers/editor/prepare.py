"""
Working copies: what the editor looks at while it decides, as opposed to what it renders from.

A camera original (4K, HDR, tens of Mbit/s) is slow to decode over and over and gives frames too big
to hand to the agent. So before the agent starts, every heavy clip gets a small standard-range copy
in footage/ under the same name, and the original moves to originals/. The agent scans, samples,
listens and finds the action in footage/ as before; render.sh takes each shot from originals/ when
the clip has one, so the finished video is cut from the full picture.

The copy keeps the clip's timing (same length, same frame times), is stored upright, and is
tonemapped when the source is HDR, so the times and crops chosen on it apply to the original as is.
Standard library only, so it runs (and is tested) without Modal.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import time
from typing import Any, Callable, Dict, List, Optional

SHORT_SIDE = 540
# Above any of these a clip gets a working copy: bigger than the finished video, HDR, or a heavy stream.
MAX_LONG_SIDE = 1920
MAX_SHORT_SIDE = 1080
HEAVY_BIT_RATE = 16_000_000
HDR_TRANSFERS = ("smpte2084", "arib-std-b67")
# Same chain as render.sh and the optimizer: to linear light, tonemap, back to bt709.
TONEMAP = "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p"
ORIGINALS = "originals"


def probe(path: str) -> Optional[Dict[str, Any]]:
    """Display size (upright), bit rate, HDR or not, and length; None when the file cannot be read."""
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
             "stream=width,height,color_transfer,color_primaries:stream_side_data=rotation:stream_tags=rotate:format=duration,bit_rate",
             "-of", "json", path],
            capture_output=True, text=True, timeout=120, stdin=subprocess.DEVNULL)
        j = json.loads(out.stdout or "{}")
        s = (j.get("streams") or [None])[0]
        if out.returncode != 0 or not s:
            return None
        rotation = 0
        for side in s.get("side_data_list") or []:
            if "rotation" in side:
                rotation = int(round(float(side["rotation"])))
        if not rotation:
            rotation = int(round(float((s.get("tags") or {}).get("rotate") or 0)))
        w, h = int(s.get("width") or 0), int(s.get("height") or 0)
        if abs(rotation) % 180 == 90:
            w, h = h, w
        fmt = j.get("format") or {}
        return {
            "width": w,
            "height": h,
            "bitRate": int(float(fmt.get("bit_rate") or 0)),
            "hdr": (s.get("color_transfer") or "").lower() in HDR_TRANSFERS or (s.get("color_primaries") or "").lower() == "bt2020",
            "seconds": float(fmt.get("duration") or 0),
        }
    except (OSError, ValueError, subprocess.SubprocessError):
        return None


def is_heavy(info: Dict[str, Any]) -> bool:
    long_side, short_side = max(info["width"], info["height"]), min(info["width"], info["height"])
    return long_side > MAX_LONG_SIDE or short_side > MAX_SHORT_SIDE or info["hdr"] or info["bitRate"] > HEAVY_BIT_RATE


def copy_args(src: str, dst: str, info: Dict[str, Any], ffmpeg: str = "ffmpeg") -> List[str]:
    """The ffmpeg command for one working copy: short side 540, H.264, frame times untouched."""
    landscape = info["width"] > info["height"]
    filters = [f"scale={'-2' if landscape else SHORT_SIDE}:{SHORT_SIDE if landscape else '-2'}:flags=fast_bilinear"]
    if info["hdr"]:
        filters.append(TONEMAP)
    args = [ffmpeg, "-hide_banner", "-nostdin", "-y", "-loglevel", "error", "-i", src, "-map", "0:v:0", "-map", "0:a:0?",
            "-vf", ",".join(filters), "-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-pix_fmt", "yuv420p",
            "-metadata:s:v:0", "rotate=0"]
    if info["hdr"]:
        args += ["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709"]
    # The container is named by dst's extension; mov and mp4 both take H.264 + AAC.
    return args + ["-c:a", "aac", "-b:a", "128k", "-ac", "2", dst]


def make_working_copies(ws: str, names: List[str], budget_sec: float, log: Callable[[str], None] = lambda _m: None) -> Dict[str, int]:
    """Gives every heavy clip in <ws>/footage a working copy and moves its original to <ws>/originals.

    Never fails the job: a clip that cannot be read, whose copy fails, or that the budget does not reach
    simply stays in footage/ as it is (the agent and render.sh then both use the original, as before).
    Returns {"made", "kept", "seconds"}.
    """
    footage, originals = os.path.join(ws, "footage"), os.path.join(ws, ORIGINALS)
    os.makedirs(originals, exist_ok=True)
    started = time.monotonic()
    made = kept = 0
    for name in names:
        src = os.path.join(footage, name)
        left = budget_sec - (time.monotonic() - started)
        info = probe(src) if os.path.isfile(src) else None
        if info is None or not is_heavy(info) or left < 30:
            kept += 1
            continue
        stem, ext = os.path.splitext(name)
        tmp = os.path.join(originals, f".{stem}.copy{ext or '.mp4'}")
        try:
            done = subprocess.run(copy_args(src, tmp, info), capture_output=True, text=True, timeout=left, stdin=subprocess.DEVNULL)
            ok = done.returncode == 0 and os.path.isfile(tmp) and os.path.getsize(tmp) > 0
        except (subprocess.TimeoutExpired, OSError):
            ok = False
        if not ok:
            if os.path.exists(tmp):
                os.remove(tmp)
            kept += 1
            log(f"working copy failed for one clip ({info['width']}x{info['height']}, {info['seconds']:.0f}s); the original is used")
            continue
        shutil.move(src, os.path.join(originals, name))
        shutil.move(tmp, src)
        made += 1
    return {"made": made, "kept": kept, "seconds": int(time.monotonic() - started)}
