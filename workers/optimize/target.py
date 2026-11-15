"""
How a clip is shrunk on arrival. Standard library only, so it runs (and is tested) without Modal.

`plan_target` mirrors lib/media/target.ts line for line; both are tested against target_cases.json.
`summarize_probe` turns ffprobe's JSON into the summary `plan_target` takes, and
`encode_args` / `copy_args` build the ffmpeg command lines for a plan.
"""
from __future__ import annotations

import math
from typing import Any, Dict, List, Optional

MAX_PORTRAIT_WIDTH = 1080
MAX_LANDSCAPE_HEIGHT = 1920
MAX_FPS = 60
COPY_MAX_BITRATE = 12_000_000
CRF = "20"
PRESET = "medium"
AUDIO_BITRATE = "192k"

HDR_TRANSFERS = ("smpte2084", "arib-std-b67")
COPYABLE = ("h264", "hevc")


def _even(n: float) -> int:
    return max(2, int(math.floor(n / 2)) * 2)


def _round_even(n: float) -> int:
    # Same as JavaScript's Math.round(n / 2) * 2 for positive n (halves round up).
    return max(2, int(math.floor(n / 2 + 0.5)) * 2)


def is_hdr(s: Dict[str, Any]) -> bool:
    return (s.get("colorTransfer") or "").lower() in HDR_TRANSFERS or (s.get("colorPrimaries") or "").lower() == "bt2020"


def plan_target(s: Dict[str, Any]) -> Dict[str, Any]:
    """The plan for one source summary (keys as in lib/media/target.ts)."""
    quarter = abs(int(round(s.get("rotation") or 0))) % 180 == 90
    dw = s["height"] if quarter else s["width"]
    dh = s["width"] if quarter else s["height"]
    portrait = dh > dw

    width, height, downscale = dw, dh, False
    if portrait and dw > MAX_PORTRAIT_WIDTH:
        width = MAX_PORTRAIT_WIDTH
        height = _round_even(dh * MAX_PORTRAIT_WIDTH / dw)
        downscale = True
    elif not portrait and dh > MAX_LANDSCAPE_HEIGHT:
        height = MAX_LANDSCAPE_HEIGHT
        width = _round_even(dw * MAX_LANDSCAPE_HEIGHT / dh)
        downscale = True

    fps = s.get("fps") if s.get("fps") and s["fps"] > 0 else None
    max_fps = MAX_FPS if fps is not None and fps > MAX_FPS + 0.5 else None
    tonemap = is_hdr(s)
    codec = (s.get("videoCodec") or "").lower()
    audio_codec = s["audioCodec"].lower() if s.get("audioCodec") else None
    audio = "none" if audio_codec is None else "copy" if audio_codec == "aac" else "aac"
    bit_rate = s.get("bitRate")

    copy = codec in COPYABLE and not downscale and not tonemap and max_fps is None and bit_rate is not None and 0 < bit_rate < COPY_MAX_BITRATE
    if copy:
        return {"action": "copy", "width": dw, "height": dh, "maxFps": None, "tonemap": False, "audio": audio, "videoTag": "hvc1" if codec == "hevc" else None}
    return {"action": "encode", "width": _even(width), "height": _even(height), "maxFps": max_fps, "tonemap": tonemap, "audio": audio, "videoTag": "hvc1"}


# ---- ffprobe ---------------------------------------------------------------------------------


def _rate(value: Optional[str]) -> Optional[float]:
    try:
        num, den = (value or "").split("/")
        n, d = float(num), float(den)
        return n / d if n > 0 and d > 0 else None
    except ValueError:
        return None


def _num(value: Any) -> Optional[float]:
    try:
        n = float(value)
        return n if math.isfinite(n) else None
    except (TypeError, ValueError):
        return None


def _rotation(stream: Dict[str, Any]) -> int:
    for side in stream.get("side_data_list") or []:
        if "rotation" in side:
            return int(round(_num(side["rotation"]) or 0))
    return int(round(_num((stream.get("tags") or {}).get("rotate")) or 0))


def summarize_probe(probe: Dict[str, Any], size_bytes: Optional[int] = None) -> Dict[str, Any]:
    """The source summary from `ffprobe -print_format json -show_format -show_streams`."""
    streams = probe.get("streams") or []
    video = next((s for s in streams if s.get("codec_type") == "video" and not (s.get("disposition") or {}).get("attached_pic")), None)
    if video is None:
        raise ValueError("no video stream")
    audio = next((s for s in streams if s.get("codec_type") == "audio"), None)
    fmt = probe.get("format") or {}
    duration = _num(fmt.get("duration")) or _num(video.get("duration"))
    bit_rate = _num(fmt.get("bit_rate"))
    size = size_bytes if size_bytes is not None else _num(fmt.get("size"))
    if not bit_rate and size and duration:
        bit_rate = size * 8 / duration
    return {
        "width": int(video.get("width") or 0),
        "height": int(video.get("height") or 0),
        "rotation": _rotation(video),
        "fps": _rate(video.get("avg_frame_rate")) or _rate(video.get("r_frame_rate")),
        "videoCodec": video.get("codec_name") or "",
        "bitRate": int(bit_rate) if bit_rate else None,
        "audioCodec": audio.get("codec_name") if audio else None,
        "colorTransfer": video.get("color_transfer"),
        "colorPrimaries": video.get("color_primaries"),
        "durationSec": duration,
    }


# ---- ffmpeg ----------------------------------------------------------------------------------

# HDR (PQ / HLG) to SDR bt709: to linear light, tonemap with Hable, back to bt709 limited range.
TONEMAP_CHAIN = "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p"


def _audio_args(plan: Dict[str, Any]) -> List[str]:
    if plan["audio"] == "none":
        return ["-an"]
    if plan["audio"] == "copy":
        return ["-c:a", "copy"]
    return ["-c:a", "aac", "-b:a", AUDIO_BITRATE]


def _common_in(src: str, ffmpeg: str) -> List[str]:
    # Only the first video and audio streams: phone .mov files carry extra data tracks MP4 cannot hold.
    return [ffmpeg, "-hide_banner", "-nostdin", "-y", "-loglevel", "error", "-i", src, "-map", "0:v:0", "-map", "0:a:0?", "-map_metadata", "0"]


def encode_args(src: str, dst: str, plan: Dict[str, Any], ffmpeg: str = "ffmpeg") -> List[str]:
    """Re-encode to H.265. ffmpeg auto-rotates while decoding, so the output is stored upright."""
    filters = [f"scale={plan['width']}:{plan['height']}:flags=lanczos"]
    if plan["tonemap"]:
        filters.append(TONEMAP_CHAIN)
    args = _common_in(src, ffmpeg) + ["-vf", ",".join(filters)]
    if plan.get("maxFps"):
        args += ["-r", str(plan["maxFps"])]
    args += ["-c:v", "libx265", "-preset", PRESET, "-crf", CRF, "-pix_fmt", "yuv420p", "-tag:v", "hvc1", "-x265-params", "log-level=error"]
    # The rotation is baked into the pixels now; make sure no rotate tag is carried over on top of it.
    args += ["-metadata:s:v:0", "rotate=0"]
    if plan["tonemap"]:
        args += ["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709"]
    return args + _audio_args(plan) + ["-movflags", "+faststart", "-f", "mp4", dst]


def copy_args(src: str, dst: str, plan: Dict[str, Any], ffmpeg: str = "ffmpeg") -> List[str]:
    """No re-encode: the same video stream remuxed into MP4 (its rotation flag kept as it is)."""
    args = _common_in(src, ffmpeg) + ["-c:v", "copy"]
    if plan.get("videoTag"):
        args += ["-tag:v", plan["videoTag"]]
    return args + _audio_args(plan) + ["-movflags", "+faststart", "-f", "mp4", dst]
