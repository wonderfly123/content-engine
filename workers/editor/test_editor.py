"""
Local tests for the editor worker: no network, no Modal, no Anthropic API.
Run: python3 -I workers/editor/test_editor.py
"""
from __future__ import annotations

import copy
import hashlib
import hmac
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from contract import (  # noqa: E402
    ManifestError, bash_denial, build_prompt, clip_filenames, extract_usage, job_brief, path_denial, preview_path,
    previous_for_agent, previous_keys, safe_filename, sign, valid_job, validate_manifest,
    SKILL_FILES, MAX_SKILL_BYTES, valid_skill_files, write_skill_files, progress_url, step_label,
)

SCRIPTS = os.path.join(HERE, "skill", "scripts")
FFMPEG = shutil.which("ffmpeg") or ("/opt/homebrew/bin/ffmpeg" if os.path.exists("/opt/homebrew/bin/ffmpeg") else None)

CLIPS = [
    {"mediaId": "m1", "filename": "IMG_0001.MOV", "url": "https://r2.example/a?sig=x"},
    {"mediaId": "m2", "filename": "../../etc/passwd.mov", "url": "https://r2.example/b?sig=y"},
    {"mediaId": "m3", "filename": "IMG_0001.mov", "url": "https://r2.example/c?sig=z"},
]
JOB = {
    "jobId": "j1", "kind": "first_cut", "videoKind": "reel", "brand": {"name": "Windandsea", "voice": "warm, short"},
    "instructions": "", "request": "make a reel of the stand build", "clips": CLIPS, "previous": None,
    "uploads": {"url": "https://app.example/api/uploads"}, "anthropicApiKey": "sk-ant-test", "model": "claude-opus-5-5",
    "callbackUrl": "https://app.example/api/editor/callback",
}


def good_manifest():
    return {
        "reply": "Two cuts are ready.", "question": None,
        "cuts": [{
            "id": "reel-15", "title": "Stand 15s", "seconds": 15, "mode": "music", "preview": {"path": "out/previews/reel-15.mp4"},
            "edl": [{"file": "IMG_0001.mov", "in": 1.0, "dur": 2.0, "speed": 1, "cropX": None},
                    {"file": "footage/passwd.mov", "in": 0, "dur": 40, "speed": 4.2, "cropX": 0.5}],
            "hookOptions": ["a", "b"], "caption": "Caption", "script": None, "coverAt": 13.5,
        }],
    }


class JobTests(unittest.TestCase):
    def test_valid_job(self):
        self.assertIsNotNone(valid_job(copy.deepcopy(JOB)))

    def test_rejects(self):
        for mutate in (
            lambda j: j.pop("anthropicApiKey"),
            lambda j: j.update(kind="other"),
            lambda j: j.update(videoKind="tiktok"),
            lambda j: j.update(clips=[]),
            lambda j: j["clips"][0].update(url="http://plain"),
            lambda j: j.update(callbackUrl="ftp://x"),
            lambda j: j.update(model="gpt-4"),
            lambda j: j.update(kind="revision"),  # a revision without previous
            lambda j: j["clips"].append(dict(CLIPS[0])),  # repeated mediaId
        ):
            j = copy.deepcopy(JOB)
            mutate(j)
            self.assertIsNone(valid_job(j))

    def test_brief_and_prompt_hold_no_secrets(self):
        files = clip_filenames(CLIPS)
        text = json.dumps(job_brief(JOB, files)) + build_prompt(JOB, files, "cutting-montage-videos")
        for secret in ("sk-ant-test", "https://", "m1"):
            self.assertNotIn(secret, text)


class SkillFilesTests(unittest.TestCase):
    def test_job_without_or_with_skill_files(self):
        self.assertIsNotNone(valid_job(copy.deepcopy(JOB)))  # none: the baked copy stands
        self.assertIsNotNone(valid_job(dict(copy.deepcopy(JOB), skillFiles=None)))
        self.assertIsNotNone(valid_job(dict(copy.deepcopy(JOB), skillFiles={"hooks.md": "# hooks", "profiles/build.md": "x"})))

    def test_job_with_bad_skill_files_is_refused(self):
        for files in (
            {"../app.py": "x"}, {"/etc/passwd": "x"}, {"scripts/render.sh": "x"}, {"profiles/../SKILL.md": "x"},
            {"hooks.md": 3}, {"hooks.md": "a\x00b"}, ["hooks.md"], "hooks.md",
            {"hooks-formulas.md": "x" * (MAX_SKILL_BYTES - 1), "hooks.md": "xx"},  # over the total
        ):
            self.assertFalse(valid_skill_files(files), files)
            self.assertIsNone(valid_job(dict(copy.deepcopy(JOB), skillFiles=files)), files)
        self.assertTrue(valid_skill_files({"hooks-formulas.md": "x" * MAX_SKILL_BYTES}))
        self.assertTrue(valid_skill_files({p: "ok" for p in SKILL_FILES}))

    def test_skill_files_match_the_skill_folder(self):
        skill = os.path.join(HERE, "skill")
        found = sorted(os.path.relpath(os.path.join(d, f), skill).replace(os.sep, "/")
                       for d, _, fs in os.walk(skill) for f in fs if f.endswith(".md") and "scripts" not in os.path.relpath(d, skill).split(os.sep))
        self.assertEqual(sorted(SKILL_FILES), found)

    def test_writes_over_the_baked_copy(self):
        with tempfile.TemporaryDirectory() as tmp:
            skill = os.path.join(tmp, "job", ".claude", "skills", "cutting-montage-videos")
            shutil.copytree(os.path.join(HERE, "skill"), skill)
            baked = open(os.path.join(skill, "intake.md")).read()
            self.assertEqual(write_skill_files(skill, None), 0)
            self.assertEqual(write_skill_files(skill, {}), 0)
            self.assertEqual(write_skill_files(skill, {"hooks.md": "# edited hooks", "profiles/build.md": "# edited build"}), 2)
            self.assertEqual(open(os.path.join(skill, "hooks.md")).read(), "# edited hooks")
            self.assertEqual(open(os.path.join(skill, "profiles", "build.md")).read(), "# edited build")
            self.assertEqual(open(os.path.join(skill, "intake.md")).read(), baked)  # untouched
            self.assertTrue(os.path.isfile(os.path.join(skill, "scripts", "render.sh")))
            with self.assertRaises(ValueError):
                write_skill_files(skill, {"../../escape.md": "x"})
            self.assertFalse(os.path.exists(os.path.join(tmp, "job", ".claude", "escape.md")))

    def test_symlink_is_replaced_not_followed(self):
        with tempfile.TemporaryDirectory() as tmp:
            skill, outside = os.path.join(tmp, "skill"), os.path.join(tmp, "outside.md")
            os.makedirs(skill)
            open(outside, "w").write("keep")
            os.symlink(outside, os.path.join(skill, "hooks.md"))
            with self.assertRaises(ValueError):  # realpath leaves the folder
                write_skill_files(skill, {"hooks.md": "x"})
            self.assertEqual(open(outside).read(), "keep")


class FilenameTests(unittest.TestCase):
    def test_safe_and_unique(self):
        files = clip_filenames(CLIPS)
        self.assertEqual(files, [("IMG_0001.mov", "m1"), ("passwd.mov", "m2"), ("IMG_0001-2.mov", "m3")])
        self.assertEqual(safe_filename(".hidden"), "hidden.mp4")
        self.assertEqual(safe_filename("café clip.MP4"), "cafe_clip.mp4")
        self.assertNotIn("/", safe_filename("a/b/../c.mov"))

    def test_previous_gets_files(self):
        prev = {"cuts": [{"id": "reel-15", "preview": {"key": "k1"}, "edl": [{"mediaId": "m3", "in": 0, "dur": 1, "speed": 1, "cropX": None}]}]}
        out = previous_for_agent(prev, clip_filenames(CLIPS))
        self.assertEqual(out["cuts"][0]["edl"][0]["file"], "IMG_0001-2.mov")
        self.assertEqual(previous_keys({"manifest": prev}), {"k1"})
        self.assertEqual(previous_keys(None), set())


class ManifestTests(unittest.TestCase):
    files = clip_filenames(CLIPS)

    def test_good_maps_media_ids(self):
        out = validate_manifest(good_manifest(), self.files)
        edl = out["cuts"][0]["edl"]
        self.assertEqual([e["mediaId"] for e in edl], ["m1", "m2"])
        self.assertNotIn("file", edl[0])
        self.assertEqual(edl[1]["cropX"], 0.5)
        self.assertEqual(out["cuts"][0]["preview"], {"path": "out/previews/reel-15.mp4"})
        self.assertIsNone(out["question"])

    def test_missing_fields(self):
        for field in ("title", "caption", "hookOptions", "coverAt", "edl", "preview", "mode", "seconds", "id"):
            m = good_manifest()
            del m["cuts"][0][field]
            with self.assertRaises(ManifestError, msg=field):
                validate_manifest(m, self.files)
        m = good_manifest()
        del m["reply"]
        with self.assertRaises(ManifestError):
            validate_manifest(m, self.files)

    def test_empty_caption_allowed(self):
        m = good_manifest()
        m["cuts"][0]["caption"] = ""
        self.assertEqual(validate_manifest(m, self.files)["cuts"][0]["caption"], "")

    def test_unknown_clip(self):
        m = good_manifest()
        m["cuts"][0]["edl"][0]["file"] = "NOT_HERE.mov"
        with self.assertRaises(ManifestError):
            validate_manifest(m, self.files)
        m["cuts"][0]["edl"][0] = {"mediaId": "m9", "in": 0, "dur": 1, "speed": 1, "cropX": None}
        with self.assertRaises(ManifestError):
            validate_manifest(m, self.files)

    def test_bad_values(self):
        for mutate in (
            lambda c: c["edl"][0].update(speed=0),
            lambda c: c["edl"][0].update(cropX=1.5),
            lambda c: c.update(coverAt=99),
            lambda c: c.update(mode="dance"),
            lambda c: c.update(preview={"key": "made-up"}),
        ):
            m = good_manifest()
            mutate(m["cuts"][0])
            with self.assertRaises(ManifestError):
                validate_manifest(m, self.files)

    def test_kept_previous_key_and_media_id(self):
        m = good_manifest()
        m["cuts"][0]["preview"] = {"key": "ws/a/previews/old.mp4"}
        m["cuts"][0]["edl"][0] = {"mediaId": "m3", "in": 0, "dur": 1, "speed": 1, "cropX": None}
        out = validate_manifest(m, self.files, {"ws/a/previews/old.mp4"})
        self.assertEqual(out["cuts"][0]["preview"], {"key": "ws/a/previews/old.mp4"})
        self.assertEqual(out["cuts"][0]["edl"][0]["mediaId"], "m3")

    def test_question_only(self):
        out = validate_manifest({"reply": "One thing first.", "question": "Setup only?", "cuts": []}, self.files)
        self.assertEqual(out["cuts"], [])
        with self.assertRaises(ManifestError):
            validate_manifest({"reply": "x", "question": None, "cuts": []}, self.files)

    def test_preview_path_confined(self):
        with tempfile.TemporaryDirectory() as ws:
            os.makedirs(os.path.join(ws, "out"))
            open(os.path.join(ws, "out", "a.mp4"), "w").close()
            self.assertTrue(preview_path(ws, "out/a.mp4").endswith("a.mp4"))
            for bad in ("../x.mp4", "/etc/passwd", "out/missing.mp4", "out/a.mov"):
                with self.assertRaises(ManifestError):
                    preview_path(ws, bad)


class UsageAndSignatureTests(unittest.TestCase):
    def test_usage_from_model_usage(self):
        # Shaped per the Python SDK reference: ResultMessage fields; model_usage values are camelCase ModelUsage.
        class Result:
            subtype, is_error, num_turns, duration_ms, total_cost_usd = "success", False, 37, 412000, 3.21
            usage = {"input_tokens": 10, "output_tokens": 20, "cache_read_input_tokens": 30, "cache_creation_input_tokens": 5}
            model_usage = {
                "claude-opus-5-5": {"inputTokens": 1200, "outputTokens": 3400, "cacheReadInputTokens": 90000, "cacheCreationInputTokens": 800, "costUSD": 3.0},
                "claude-haiku": {"inputTokens": 100, "outputTokens": 50, "cacheReadInputTokens": 0, "cacheCreationInputTokens": 0, "costUSD": 0.21},
            }
        u = extract_usage(Result(), 412.04)
        self.assertEqual(u, {"inputTokens": 1300, "outputTokens": 3450, "cacheReadTokens": 90000, "costUsd": 3.21, "turns": 37, "seconds": 412.0})

    def test_usage_from_usage_dict_and_fallback(self):
        u = extract_usage({"num_turns": 3, "usage": {"input_tokens": 10, "output_tokens": 20, "cache_read_input_tokens": 30}, "total_cost_usd": None}, 9)
        self.assertEqual((u["inputTokens"], u["outputTokens"], u["cacheReadTokens"], u["costUsd"], u["turns"]), (10, 20, 30, 0.0, 3))
        u = extract_usage(None, 1500, {"inputTokens": 5, "outputTokens": 6, "cacheReadTokens": 7, "turns": 2})
        self.assertEqual((u["inputTokens"], u["turns"], u["seconds"]), (5, 2, 1500.0))

    def test_signature_matches_app_scheme(self):
        body = json.dumps({"jobId": "j1", "ok": True}, separators=(",", ":")).encode()
        self.assertEqual(sign("s3cret", body), hmac.new(b"s3cret", body, hashlib.sha256).hexdigest())
        self.assertRegex(sign("s3cret", body), r"^[0-9a-f]{64}$")


class GuardTests(unittest.TestCase):
    ws = "/tmp/editor-abc/job"

    def test_bash_allowed(self):
        for cmd in (
            "python3 .claude/skills/cutting-montage-videos/scripts/scan.py footage work/scan",
            "printf '%s\\n' a.mov b.mov | bash $SK/sample.sh footage work/samples/reel-15",
            "SK=.claude/skills/cutting-montage-videos/scripts; bash $SK/render.sh footage work/edl/reel-15.tsv out/previews/reel-15.mp4 2>/dev/null",
            "ffprobe -v error -show_entries format=duration -of csv=p=0 footage/a.mov",
            f"ls {self.ws}/out",
            "echo $((30 / 2))",
        ):
            self.assertIsNone(bash_denial(cmd, self.ws), cmd)

    def test_bash_refused(self):
        for cmd in ("curl https://evil.example", "cat /etc/passwd", "printenv", "echo $ANTHROPIC_API_KEY", "cat ../../x",
                    "cd / && ls", "cat ~/.bashrc", "pip install x", "python3 -c 'open(\"/proc/self/environ\")'", "ls /tmp/other"):
            self.assertIsNotNone(bash_denial(cmd, self.ws), cmd)

    def test_paths(self):
        with tempfile.TemporaryDirectory() as ws:
            self.assertIsNone(path_denial("Read", {"file_path": os.path.join(ws, "job.json")}, ws))
            self.assertIsNone(path_denial("Write", {"file_path": "out/manifest.json"}, ws))
            self.assertIsNone(path_denial("Glob", {"pattern": "footage/*.mov"}, ws))
            self.assertIsNotNone(path_denial("Read", {"file_path": "/etc/passwd"}, ws))
            self.assertIsNotNone(path_denial("Edit", {"file_path": "../x"}, ws))
            self.assertIsNotNone(path_denial("Glob", {"pattern": "/root/**"}, ws))
            self.assertIsNotNone(path_denial("Grep", {"pattern": "x", "path": "/"}, ws))


@unittest.skipUnless(FFMPEG, "ffmpeg not installed")
class RenderTests(unittest.TestCase):
    def test_render_1080x1920(self):
        env = dict(os.environ, PATH=os.path.dirname(FFMPEG) + os.pathsep + os.environ.get("PATH", ""))
        with tempfile.TemporaryDirectory() as ws:
            footage, work = os.path.join(ws, "footage"), os.path.join(ws, "work")
            os.makedirs(footage), os.makedirs(work)
            subprocess.run([FFMPEG, "-v", "error", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=30:duration=6",
                            "-pix_fmt", "yuv420p", os.path.join(footage, "wide.mp4")], check=True, env=env)
            subprocess.run([FFMPEG, "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=360x640:rate=30:duration=4",
                            "-pix_fmt", "yuv420p", os.path.join(footage, "tall.mp4")], check=True, env=env)
            with open(os.path.join(work, "draft.tsv"), "w") as f:
                f.write("tall.mp4|0.5|1.5|1\nwide.mp4|0|5|4|0.5\ntall.mp4|2.2|1.2|1\n")
            fit = subprocess.run([sys.executable, os.path.join(SCRIPTS, "fit.py"), footage, os.path.join(work, "draft.tsv"), "4",
                                  os.path.join(work, "cut.tsv")], capture_output=True, text=True, env=env)
            self.assertEqual(fit.returncode, 0, fit.stdout + fit.stderr)
            out = os.path.join(ws, "out", "cut.mp4")
            os.makedirs(os.path.dirname(out))
            r = subprocess.run(["bash", os.path.join(SCRIPTS, "render.sh"), footage, os.path.join(work, "cut.tsv"), out],
                               capture_output=True, text=True, env=env)
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
            probe = json.loads(subprocess.check_output([os.path.join(os.path.dirname(FFMPEG), "ffprobe"), "-v", "error", "-select_streams", "v:0",
                                                        "-show_entries", "stream=width,height,r_frame_rate:format=duration", "-of", "json", out]))
            s = probe["streams"][0]
            self.assertEqual((s["width"], s["height"], s["r_frame_rate"]), (1080, 1920, "30/1"))
            self.assertAlmostEqual(float(probe["format"]["duration"]), 4.0, delta=0.15)
            self.assertTrue(os.path.isfile(out.replace(".mp4", ".check.jpg")))
            edl = json.loads(subprocess.check_output([sys.executable, os.path.join(SCRIPTS, "edl2json.py"), "json", os.path.join(work, "cut.tsv")]))
            self.assertEqual([e["file"] for e in edl], ["tall.mp4", "wide.mp4", "tall.mp4"])
            self.assertEqual(edl[1]["cropX"], 0.5)
            self.assertIsNone(edl[0]["cropX"])


class TestProgress(unittest.TestCase):
    def test_step_labels(self):
        self.assertEqual(step_label("Bash", {"command": "python3 $SK/scan.py footage work/scan"}), "Looking through the clips")
        self.assertEqual(step_label("Bash", {"command": "bash $SK/render.sh footage work/edl/story-15.tsv out/previews/story-15.mp4"}), "Rendering the 15s story")
        self.assertEqual(step_label("Bash", {"command": "python3 $SK/fit.py footage work/edl/reel-30.draft.tsv 30 work/edl/reel-30.tsv"}), "Fitting the 30s reel to length")
        self.assertEqual(step_label("Read", {"file_path": "/x/job/out/previews/reel-15.check.jpg"}), "Checking the 15s reel")
        self.assertEqual(step_label("Write", {"file_path": "/x/job/out/manifest.json"}), "Writing hooks and caption")
        self.assertIsNone(step_label("Bash", {"command": "ls footage"}))
        self.assertIsNone(step_label("Glob", {"pattern": "*"}))
        # Never a file name or a command.
        self.assertNotIn("IMG", step_label("Bash", {"command": "printf 'IMG_1.mov' | bash $SK/sample.sh footage work/samples/a"}) or "")

    def test_progress_url(self):
        self.assertEqual(progress_url("https://app.nekter.io/api/editor/callback"), "https://app.nekter.io/api/editor/progress")
        self.assertIsNone(progress_url("https://evil.test/other"))


if __name__ == "__main__":
    unittest.main(verbosity=1)
