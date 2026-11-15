"""
Tests for target.py. Runs under pytest, or on its own: `python3 workers/optimize/test_target.py`.

1. The rules table (target_cases.json, shared with lib/media/__tests__/target.test.ts).
2. A real ffmpeg run (skipped when ffmpeg/ffprobe are missing): tiny test clips made with
   `testsrc` (4K landscape, a phone-style rotated portrait, and an HLG HDR clip) go through the
   worker's own command builders, and ffprobe checks the result.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from target import copy_args, encode_args, plan_target, summarize_probe  # noqa: E402

FFMPEG = shutil.which("ffmpeg")
FFPROBE = shutil.which("ffprobe")


def _cases():
    with open(os.path.join(HERE, "target_cases.json")) as f:
        return json.load(f)


def test_rules_table():
    cases = _cases()
    assert len(cases) > 10
    for case in cases:
        got = plan_target(case["source"])
        assert got == case["plan"], f"{case['name']}: {got} != {case['plan']}"


def _probe(path):
    out = subprocess.run([FFPROBE, "-v", "error", "-print_format", "json", "-show_format", "-show_streams", path], check=True, capture_output=True, text=True).stdout
    return json.loads(out)


def _make(path, extra_in, extra_out, size="3840x2160", seconds="1"):
    cmd = [FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", f"testsrc=size={size}:rate=30:duration={seconds}",
           "-f", "lavfi", "-i", f"sine=frequency=440:duration={seconds}"] + extra_in + ["-shortest"] + extra_out + [path]
    subprocess.run(cmd, check=True)


def _run_plan(src, dst):
    summary = summarize_probe(_probe(src))
    plan = plan_target(summary)
    build = copy_args if plan["action"] == "copy" else encode_args
    subprocess.run(build(src, dst, plan, ffmpeg=FFMPEG), check=True)
    out = _probe(dst)
    video = next(s for s in out["streams"] if s["codec_type"] == "video")
    return summary, plan, out, video


def _skip_without_ffmpeg():
    if not FFMPEG or not FFPROBE:
        try:
            import pytest  # type: ignore

            pytest.skip("ffmpeg/ffprobe not installed")
        except ImportError:
            print("SKIP: ffmpeg/ffprobe not installed")
        return True
    return False


def test_ffmpeg_4k_landscape():
    if _skip_without_ffmpeg():
        return
    with tempfile.TemporaryDirectory() as tmp:
        src, dst = os.path.join(tmp, "land.mp4"), os.path.join(tmp, "out.mp4")
        _make(src, [], ["-c:v", "libx264", "-preset", "ultrafast", "-b:v", "40M", "-c:a", "aac"])
        _, plan, out, video = _run_plan(src, dst)
        assert plan["action"] == "encode"
        assert (video["width"], video["height"]) == (3414, 1920)
        assert video["codec_name"] == "hevc" and video["codec_tag_string"] == "hvc1"
        assert any(s["codec_type"] == "audio" and s["codec_name"] == "aac" for s in out["streams"])


def test_ffmpeg_rotated_portrait():
    """A phone clip: stored 3840x2160 landscape with a -90 rotation flag, shown as portrait."""
    if _skip_without_ffmpeg():
        return
    with tempfile.TemporaryDirectory() as tmp:
        plain, src, dst = os.path.join(tmp, "plain.mov"), os.path.join(tmp, "portrait.mov"), os.path.join(tmp, "out.mp4")
        _make(plain, [], ["-c:v", "libx264", "-preset", "ultrafast", "-b:v", "40M", "-c:a", "pcm_s16le"])
        # Add the rotation flag the way a phone does (display matrix); `rotate` tags are ignored by newer ffmpeg.
        rotate = [FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-display_rotation:v:0", "90", "-i", plain, "-c", "copy", src]
        if subprocess.run(rotate).returncode != 0:  # ffmpeg before 6.1 has no -display_rotation
            subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-i", plain, "-c", "copy", "-metadata:s:v:0", "rotate=90", src], check=True)
        summary, plan, out, video = _run_plan(src, dst)
        assert abs(summary["rotation"]) == 90, summary
        assert plan["action"] == "encode" and plan["audio"] == "aac"
        # Rotation baked in: stored upright, no rotation flag left.
        assert (video["width"], video["height"]) == (1080, 1920)
        assert summarize_probe(out)["rotation"] == 0
        assert video["codec_name"] == "hevc"


def test_ffmpeg_hdr_tonemapped():
    if _skip_without_ffmpeg():
        return
    with tempfile.TemporaryDirectory() as tmp:
        src, dst = os.path.join(tmp, "hdr.mp4"), os.path.join(tmp, "out.mp4")
        _make(src, [], ["-c:v", "libx265", "-preset", "ultrafast", "-pix_fmt", "yuv420p10le", "-x265-params", "log-level=error",
                        "-vf", "setparams=color_primaries=bt2020:color_trc=arib-std-b67:colorspace=bt2020nc:range=tv", "-c:a", "aac"], size="1280x720")
        summary, plan, _, video = _run_plan(src, dst)
        assert summary["colorTransfer"] == "arib-std-b67"
        assert plan["tonemap"] is True
        assert video["color_transfer"] == "bt709" and video["color_primaries"] == "bt709"
        assert video["pix_fmt"] == "yuv420p"


def test_ffmpeg_copy():
    if _skip_without_ffmpeg():
        return
    with tempfile.TemporaryDirectory() as tmp:
        src, dst = os.path.join(tmp, "small.mov"), os.path.join(tmp, "out.mp4")
        _make(src, [], ["-c:v", "libx264", "-preset", "ultrafast", "-b:v", "2M", "-c:a", "aac"], size="1080x1920")
        _, plan, _, video = _run_plan(src, dst)
        assert plan["action"] == "copy"
        assert (video["width"], video["height"]) == (1080, 1920) and video["codec_name"] == "h264"


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for t in tests:
        t()
        print(f"ok  {t.__name__}")
    print(f"{len(tests)} passed")
