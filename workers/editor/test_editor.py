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
    MAX_TRACKS, MAX_MUSIC_START, music_filenames, previous_music, silent_name,
)

import epidemic  # noqa: E402
import prepare  # noqa: E402
from epidemic import EpidemicClient, EpidemicError, MusicFinder, compact, track_filename  # noqa: E402

SCRIPTS = os.path.join(HERE, "skill", "scripts")
sys.path.insert(0, SCRIPTS)
import numpy as np  # noqa: E402
import music  # noqa: E402
from beatfit import allocate_beats, beat_start, retime  # noqa: E402
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


class SpeechCheckTests(unittest.TestCase):
    """A shot that keeps its sound must not cut into a word or stop mid-sentence."""

    WORDS = [  # "Today we're doing cardio kickboxing.  [pause]  You put combos together and then you rest."
        (1.00, 1.30, "Today"), (1.32, 1.50, "we're"), (1.52, 1.80, "doing"), (1.82, 2.20, "cardio"), (2.22, 2.90, "kickboxing."),
        (3.60, 3.75, "You"), (3.77, 3.95, "put"), (3.97, 4.40, "combos"), (4.42, 4.90, "together"),
        (4.92, 5.05, "and"), (5.07, 5.25, "then"), (5.27, 5.40, "you"), (5.42, 5.80, "rest."),
    ]

    def run_check(self, edl_lines, words=True, phrases=True, word_rows=None, phrase_rows=None):
        with tempfile.TemporaryDirectory() as d:
            listen = os.path.join(d, "listen")
            os.makedirs(listen)
            if words:
                with open(os.path.join(listen, "words.tsv"), "w") as f:
                    f.write("clip\tstart\tend\tword\n" + "".join(f"talk.mov\t{s}\t{e}\t{w}\n" for s, e, w in (word_rows or self.WORDS)))
            if phrases and phrase_rows:
                with open(os.path.join(listen, "speech.tsv"), "w") as f:
                    f.write("clip\tstart\tend\ttext\n" + "".join(f"talk.mov\t{s}\t{e}\t{t}\n" for s, e, t in phrase_rows))
                phrases = False
            if phrases:
                with open(os.path.join(listen, "speech.tsv"), "w") as f:
                    f.write("clip\tstart\tend\ttext\ntalk.mov\t1.00\t2.90\tToday we're doing cardio kickboxing.\n"
                            "talk.mov\t3.60\t5.80\tYou put combos together and then you rest.\n")
            edl = os.path.join(d, "cut.beat.tsv")
            with open(edl, "w") as f:
                f.write("\n".join(edl_lines) + "\n")
            r = subprocess.run([sys.executable, os.path.join(SCRIPTS, "speechcheck.py"), edl, listen], capture_output=True, text=True)
            report = ""
            if os.path.isfile(os.path.join(d, "cut.beat.speech.txt")):
                with open(os.path.join(d, "cut.beat.speech.txt")) as f:
                    report = f.read()
            return r.returncode, r.stdout, report

    def test_a_whole_sentence_with_room_passes(self):
        code, out, report = self.run_check(["action.mov|4|1.5|1", "talk.mov|0.8|2.4|1||1"])
        self.assertEqual(code, 0, out)
        self.assertIn("shot 2 talk.mov 0.80-3.20: ok", out)
        self.assertTrue(out.strip().endswith("PASS"))
        self.assertEqual(report, out)                      # the reviewer reads the same text

    def test_a_shot_that_cuts_off_a_word_fails_with_the_corrected_line(self):
        code, out, _ = self.run_check(["talk.mov|0.8|1.8|1||1"])           # ends at 2.60, inside "kickboxing."
        self.assertEqual(code, 1)
        self.assertIn('cuts off "kickboxing."', out)
        self.assertIn("use: talk.mov|0.80|2.40|1||1", out)                  # out to 2.90 + 0.3
        self.assertIn("FAIL 1 talking shot cut into speech", out)

    def test_a_shot_that_starts_inside_a_word_or_too_tight_fails(self):
        code, out, _ = self.run_check(["talk.mov|1.15|2.05|1||1"])          # starts inside "Today"
        self.assertEqual(code, 1)
        self.assertIn('starts inside "Today"', out)
        self.assertIn("use: talk.mov|0.80|2.40|1||1", out)
        code, out, _ = self.run_check(["talk.mov|0.97|2.23|1||1"])          # 0.03s before the first word
        self.assertEqual(code, 1)
        self.assertIn('starts too tight on "Today"', out)

    def test_stopping_or_starting_mid_sentence_fails_even_between_words(self):
        code, out, _ = self.run_check(["talk.mov|3.4|1.51|1||1"])           # ends at 4.91, between "together" and "and"
        self.assertEqual(code, 1)
        self.assertIn('ends mid-sentence, before "and"', out)
        self.assertIn("use: talk.mov|3.40|2.70|1||1", out)                  # out to "rest." 5.80 + 0.3
        code, out, _ = self.run_check(["talk.mov|4.91|1.2|1||1"])           # starts between "together" and "and"
        self.assertEqual(code, 1)
        self.assertIn('starts mid-sentence, after "together"', out)
        self.assertIn("use: talk.mov|3.40|", out)                           # back to "You" 3.60 - 0.2

    def test_stopping_at_the_end_of_a_sentence_is_fine_even_with_more_speech_after(self):
        code, out, _ = self.run_check(["talk.mov|0.8|2.4|1||1"])            # first sentence only; a pause follows
        self.assertEqual(code, 0, out)

    def test_silent_shots_are_not_checked_and_phrases_stand_in_for_words(self):
        code, out, _ = self.run_check(["talk.mov|1.5|0.8|1"])               # no |1: silent under the music
        self.assertEqual(code, 0, out)
        self.assertIn("no shot keeps its own sound", out)
        code, out, _ = self.run_check(["talk.mov|0.8|1.8|1||1"], words=False)   # only speech.tsv: cuts into the phrase
        self.assertEqual(code, 1)
        self.assertIn("cuts off", out)
        self.assertIn("use: talk.mov|0.80|2.40|1||1", out)

    def test_real_speech_with_no_full_stops_and_no_gap_between_sentences(self):
        # Word times as the transcriber gave them for a real phone clip: no punctuation, and the next sentence
        # starts the instant the last one ends. The phrases are what mark where a sentence may be cut.
        words = [(4.44, 4.76, "punches"), (4.76, 4.94, "to"), (4.94, 5.22, "kicks"), (5.22, 5.42, "as"), (5.42, 5.58, "well"),
                 (5.58, 5.74, "as"), (5.74, 5.94, "kicks"), (5.94, 6.14, "to"), (6.14, 6.48, "punches"),
                 (6.48, 7.16, "Putting"), (7.16, 7.36, "some"), (7.36, 7.74, "combos"), (7.74, 8.16, "together")]
        phrases = [(4.44, 6.48, "punches to kicks as well as kicks to punches"), (6.48, 8.16, "Putting some combos together")]
        code, out, _ = self.run_check(["talk.mov|4.3|2.367|1||1"], word_rows=words, phrase_rows=phrases)   # ends 6.667, into "Putting"
        self.assertEqual(code, 1)
        self.assertIn('catches the start of "Putting"', out)
        self.assertIn("use: talk.mov|4.30|2.18|1||1", out)                  # out at 6.48, where the sentence ends
        code, out, _ = self.run_check(["talk.mov|4.3|2.18|1||1"], word_rows=words, phrase_rows=phrases)
        self.assertEqual(code, 0, out)                                      # the corrected line passes
        code, out, _ = self.run_check(["talk.mov|4.3|1.45|1||1"], word_rows=words, phrase_rows=phrases)    # ends 5.75, between words
        self.assertEqual(code, 1)
        self.assertIn("ends mid-sentence", out)

    def test_step_label(self):
        self.assertEqual(step_label("Bash", {"command": "python3 $SK/speechcheck.py work/edl/a.beat.tsv work/listen"}), "Checking nobody is cut off mid-word")


class WorkingCopyTests(unittest.TestCase):
    """Heavy camera originals: the agent watches a small copy, render.sh cuts from the original."""

    def setUp(self):
        self.env = dict(os.environ, PATH=os.path.dirname(FFMPEG) + os.pathsep + os.environ.get("PATH", ""))
        self.ffprobe = os.path.join(os.path.dirname(FFMPEG), "ffprobe")

    def _video(self, path):
        j = json.loads(subprocess.check_output([self.ffprobe, "-v", "error", "-select_streams", "v:0", "-show_entries",
                                                "stream=width,height,color_transfer,pix_fmt:format=duration", "-of", "json", path]))
        return j["streams"][0], float(j["format"]["duration"])

    def test_heavy_rules(self):
        base = {"width": 1080, "height": 1920, "bitRate": 8_000_000, "hdr": False, "seconds": 10}
        self.assertFalse(prepare.is_heavy(base))
        self.assertTrue(prepare.is_heavy(dict(base, width=2160, height=3840)))
        self.assertTrue(prepare.is_heavy(dict(base, hdr=True)))
        self.assertTrue(prepare.is_heavy(dict(base, bitRate=40_000_000)))
        self.assertIn("scale=540:-2:flags=fast_bilinear", " ".join(prepare.copy_args("a", "b", base)))
        self.assertIn("scale=-2:540:flags=fast_bilinear", " ".join(prepare.copy_args("a", "b", dict(base, width=1920, height=1080))))
        self.assertIn("tonemap", " ".join(prepare.copy_args("a", "b", dict(base, hdr=True))))

    def test_4k_hdr_clip_gets_a_small_copy_and_is_rendered_from_the_original(self):
        with tempfile.TemporaryDirectory() as ws:
            footage, work = os.path.join(ws, "footage"), os.path.join(ws, "work")
            os.makedirs(footage), os.makedirs(work)
            heavy, light = os.path.join(footage, "IMG_0001.mov"), os.path.join(footage, "small.mp4")
            # A 4K, 60 fps, 10-bit HLG clip with sound, like an iPhone original; and a clip that needs no copy.
            subprocess.run([FFMPEG, "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=2160x3840:rate=60:duration=4",
                            "-f", "lavfi", "-i", "sine=frequency=440:duration=4", "-c:v", "libx265", "-preset", "ultrafast",
                            "-pix_fmt", "yuv420p10le", "-tag:v", "hvc1", "-c:a", "aac", "-shortest",
                            "-x265-params", "log-level=error:colorprim=bt2020:transfer=arib-std-b67:colormatrix=bt2020nc", heavy], check=True, env=self.env)
            subprocess.run([FFMPEG, "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=360x640:rate=30:duration=3",
                            "-pix_fmt", "yuv420p", light], check=True, env=self.env)
            before = os.path.getsize(heavy)

            cwd = os.getcwd()
            os.environ["PATH"], old_path = self.env["PATH"], os.environ.get("PATH", "")
            try:
                done = prepare.make_working_copies(ws, ["IMG_0001.mov", "small.mp4"], 300)
            finally:
                os.environ["PATH"] = old_path
                os.chdir(cwd)
            self.assertEqual((done["made"], done["kept"]), (1, 1))

            original = os.path.join(ws, "originals", "IMG_0001.mov")
            self.assertEqual(os.path.getsize(original), before)          # the original is intact, just moved
            self.assertFalse(os.path.exists(os.path.join(ws, "originals", "small.mp4")))
            copy_stream, copy_seconds = self._video(heavy)
            self.assertEqual((copy_stream["width"], copy_stream["height"], copy_stream["pix_fmt"]), (540, 960, "yuv420p"))
            self.assertEqual(copy_stream.get("color_transfer"), "bt709")  # tonemapped: no washed-out frames
            self.assertAlmostEqual(copy_seconds, 4.0, delta=0.1)           # same timing as the original
            self.assertLess(os.path.getsize(heavy), before)

            # Proof the render reads the original: the working copy is swapped for plain red, and the cut is not red.
            subprocess.run([FFMPEG, "-v", "error", "-y", "-f", "lavfi", "-i", "color=red:size=540x960:rate=30:duration=4",
                            "-pix_fmt", "yuv420p", heavy], check=True, env=self.env)
            with open(os.path.join(work, "cut.tsv"), "w") as f:
                f.write("IMG_0001.mov|0.5|1.5|1\nsmall.mp4|0.5|1|1\n")
            out = os.path.join(ws, "out", "cut.mp4")
            os.makedirs(os.path.dirname(out))
            r = subprocess.run(["bash", os.path.join(SCRIPTS, "render.sh"), footage, os.path.join(work, "cut.tsv"), out],
                               capture_output=True, text=True, env=self.env)
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
            stream, seconds = self._video(out)
            self.assertEqual((stream["width"], stream["height"]), (1080, 1920))
            self.assertAlmostEqual(seconds, 2.5, delta=0.15)
            pixel = subprocess.check_output([FFMPEG, "-v", "error", "-ss", "0.5", "-i", out, "-frames:v", "1", "-vf", "scale=1:1",
                                             "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], env=self.env)
            self.assertGreater(pixel[1] + pixel[2], 60, "the first shot is plain red: render.sh read the working copy")

    def test_a_clip_that_cannot_be_read_is_left_alone(self):
        with tempfile.TemporaryDirectory() as ws:
            os.makedirs(os.path.join(ws, "footage"))
            with open(os.path.join(ws, "footage", "broken.mov"), "wb") as f:
                f.write(b"not a video")
            os.environ["PATH"], old_path = self.env["PATH"], os.environ.get("PATH", "")
            try:
                done = prepare.make_working_copies(ws, ["broken.mov", "missing.mov"], 60)
            finally:
                os.environ["PATH"] = old_path
            self.assertEqual((done["made"], done["kept"]), (0, 2))
            self.assertTrue(os.path.isfile(os.path.join(ws, "footage", "broken.mov")))


class TestProgress(unittest.TestCase):
    def test_step_labels(self):
        self.assertEqual(step_label("Bash", {"command": "python3 $SK/scan.py footage work/scan"}), "Looking through the clips")
        self.assertEqual(step_label("Bash", {"command": "bash $SK/render.sh footage work/edl/story-15.tsv out/previews/story-15.mp4"}), "Rendering the 15s story")
        self.assertEqual(step_label("Bash", {"command": "python3 $SK/fit.py footage work/edl/reel-30.draft.tsv 30 work/edl/reel-30.tsv"}), "Fitting the 30s reel to length")
        self.assertEqual(step_label("Read", {"file_path": "/x/job/out/previews/reel-15.check.jpg"}), "Checking the 15s reel")
        self.assertEqual(step_label("Write", {"file_path": "/x/job/out/manifest.json"}), "Writing hooks and caption")
        self.assertIsNone(step_label("Bash", {"command": "ls footage"}))
        self.assertIsNone(step_label("Glob", {"pattern": "*"}))
        self.assertEqual(step_label("Agent", {"subagent_type": "reviewer", "prompt": "check reel-15"}), "Reviewing the cut")
        self.assertEqual(step_label("Task", {"subagent_type": "reviewer"}), "Reviewing the cut")
        # Never a file name or a command.
        self.assertNotIn("IMG", step_label("Bash", {"command": "printf 'IMG_1.mov' | bash $SK/sample.sh footage work/samples/a"}) or "")

    def test_progress_url(self):
        self.assertEqual(progress_url("https://app.nekter.io/api/editor/callback"), "https://app.nekter.io/api/editor/progress")
        self.assertIsNone(progress_url("https://evil.test/other"))

    def test_music_step_labels(self):
        self.assertEqual(step_label("Bash", {"command": "python3 $SK/beatfit.py footage work/edl/reel-15.tsv music/01-a.mp3 auto 15 work/edl/reel-15.beat.tsv"}),
                         "Timing the 15s reel to the beat")
        self.assertEqual(step_label("Bash", {"command": "bash $SK/mix.sh out/previews/reel-30.mp4 music/01-a.mp3 41.2"}), "Adding the music to the 30s reel")
        self.assertEqual(step_label("Bash", {"command": "python3 $SK/music.py info music/01-a.mp3"}), "Listening for the beat")


TRACKS = [
    {"id": "t1", "title": "Summer Days (Remix)", "seconds": 180.0, "bpm": 120.0, "firstBeat": 0.25, "beatStrength": 4.1, "loudestFrom": 62,
     "url": "https://r2.example/music/library/a.mp3?sig=1"},
    {"id": "t2", "title": "Summer Days (Remix)", "seconds": 95.5, "bpm": None, "firstBeat": None, "beatStrength": None, "loudestFrom": None,
     "url": "https://r2.example/music/library/uploads/b.m4a?sig=2"},
]


def music_job():
    return dict(copy.deepcopy(JOB), music=copy.deepcopy(TRACKS))


class MusicContractTests(unittest.TestCase):
    def test_job_with_music(self):
        self.assertIsNotNone(valid_job(music_job()))
        self.assertIsNotNone(valid_job(dict(copy.deepcopy(JOB), music=None)))
        self.assertIsNotNone(valid_job(dict(copy.deepcopy(JOB), music=[])))

    def test_bad_music_refused(self):
        for mutate in (
            lambda j: j["music"][0].update(url="http://plain.example/a.mp3"),
            lambda j: j["music"][1].update(id="t1"),
            lambda j: j["music"][0].update(seconds=0),
            lambda j: j["music"][0].update(bpm="fast"),
            lambda j: j["music"][0].update(title=""),
            lambda j: j.update(music={"t1": "x"}),
            lambda j: j.update(music=[dict(TRACKS[0], id=f"t{i}") for i in range(MAX_TRACKS + 1)]),
        ):
            job = music_job()
            mutate(job)
            self.assertIsNone(valid_job(job))

    def test_music_filenames_safe_and_unique(self):
        names = music_filenames(TRACKS)
        self.assertEqual(names, [("01-summer-days-remix.mp3", "t1"), ("02-summer-days-remix.m4a", "t2")])
        self.assertEqual(music_filenames([{"id": "x", "title": "../../etc/passwd", "url": "https://a/b.exe"}]), [("01-etc-passwd.mp3", "x")])
        self.assertEqual(music_filenames(None), [])

    def test_brief_lists_music_without_links_or_ids(self):
        job = music_job()
        brief = job_brief(job, clip_filenames(job["clips"]))
        self.assertEqual([t["file"] for t in brief["music"]], ["01-summer-days-remix.mp3", "02-summer-days-remix.m4a"])
        self.assertEqual(brief["music"][0]["bpm"], 120.0)
        text = json.dumps(brief)
        self.assertNotIn("https://", text)
        self.assertNotIn('"t1"', text)
        only = job_brief(job, clip_filenames(job["clips"]), {"02-summer-days-remix.m4a"})
        self.assertEqual([t["file"] for t in only["music"]], ["02-summer-days-remix.m4a"])
        self.assertIn("2 tracks in music/", build_prompt(job, clip_filenames(job["clips"]), "s"))

    def test_manifest_music_maps_to_track_id(self):
        files, tracks = clip_filenames(CLIPS), music_filenames(TRACKS)
        raw = good_manifest()
        raw["cuts"][0]["music"] = {"file": "music/01-summer-days-remix.mp3", "start": 41.2187}
        out = validate_manifest(raw, files, tracks=tracks)
        self.assertEqual(out["cuts"][0]["music"], {"trackId": "t1", "start": 41.219})
        raw["cuts"][0]["music"] = None
        self.assertIsNone(validate_manifest(raw, files, tracks=tracks)["cuts"][0]["music"])
        del raw["cuts"][0]["music"]
        self.assertIsNone(validate_manifest(raw, files, tracks=tracks)["cuts"][0]["music"])

    def test_manifest_music_refused(self):
        files, tracks = clip_filenames(CLIPS), music_filenames(TRACKS)
        for music in ({"file": "03-nope.mp3", "start": 1}, {"file": "../music/01-summer-days-remix.mp3", "start": 1},
                      {"file": "01-summer-days-remix.mp3", "start": -1}, {"file": "01-summer-days-remix.mp3", "start": MAX_MUSIC_START + 1},
                      {"file": "01-summer-days-remix.mp3"}, "01-summer-days-remix.mp3"):
            raw = good_manifest()
            raw["cuts"][0]["music"] = music
            with self.assertRaises(ManifestError, msg=str(music)):
                validate_manifest(raw, files, tracks=tracks)
        # No library at all: any track is refused.
        raw = good_manifest()
        raw["cuts"][0]["music"] = {"file": "01-summer-days-remix.mp3", "start": 1}
        with self.assertRaises(ManifestError):
            validate_manifest(raw, files)

    def test_kept_cut_keeps_previous_music(self):
        previous = {"manifest": {"cuts": [{"id": "reel-15", "preview": {"key": "ws/x/preview/j0/reel-15.mp4", "mediaId": "p1"},
                                           "music": {"trackId": "t2", "title": "Summer Days", "start": 12.5,
                                                     "silent": {"key": "ws/x/preview/j0/reel-15-nomusic.mp4", "mediaId": "p2"}},
                                           "edl": [{"mediaId": "m1", "in": 0, "dur": 1, "speed": 1, "cropX": None}]}]}}
        raw = good_manifest()
        raw["cuts"][0]["preview"] = {"key": "ws/x/preview/j0/reel-15.mp4"}
        raw["cuts"][0]["music"] = {"file": "made-up.mp3", "start": 999}  # ignored for a kept cut
        out = validate_manifest(raw, clip_filenames(CLIPS), previous_keys(previous), music_filenames(TRACKS), previous_music(previous))
        self.assertEqual(out["cuts"][0]["music"], {"trackId": "t2", "start": 12.5, "silent": {"key": "ws/x/preview/j0/reel-15-nomusic.mp4"}})
        agent = previous_for_agent(previous["manifest"], clip_filenames(CLIPS), music_filenames(TRACKS))
        self.assertEqual(agent["cuts"][0]["music"], {"file": "02-summer-days-remix.m4a", "title": "Summer Days", "start": 12.5})
        self.assertNotIn("silent", json.dumps(agent["cuts"][0]["music"]))

    def test_silent_name(self):
        self.assertEqual(silent_name("reel-15"), "reel-15-nomusic.mp4")


class BeatfitTests(unittest.TestCase):
    def test_allocate_beats_sums_to_target(self):
        p = 0.5  # 120 bpm
        n = allocate_beats([1.2, 0.4, 3.0, 2.1, 1.0], p, 15)
        self.assertEqual(sum(n), 30)
        self.assertGreaterEqual(n[0], 2)
        self.assertTrue(all(x >= 1 for x in n))
        # Too many shots for the length: every shot keeps its minimum and the total is as close as it can be.
        self.assertEqual(allocate_beats([0.1] * 10, 0.5, 2), [2] + [1] * 9)

    def test_retime_lands_on_frames_and_beats(self):
        p = 60 / 128
        rows = [["a.mov", "1.0", "2.0", "1"], ["b.mov", "0", "8.0", "4", "0.5"], ["a.mov", "5.0", "1.0", "1"]]
        n = allocate_beats([2.0, 2.0, 1.0], p, 5)
        out, total, problems = retime(rows, n, p, lambda f: 30.0)
        self.assertEqual(problems, [])
        self.assertAlmostEqual(total, sum(n) * p, delta=1 / 30)
        cut, t = 0.0, 0.0
        for r, k in zip(out, n):
            dur = float(r[2]) if float(r[3]) == 1 else float(r[2]) / float(r[3])
            cut += dur
            t += k * p
            self.assertAlmostEqual(cut, t, delta=1 / 30 + 1e-6)          # every cut within a frame of its beat
            self.assertAlmostEqual(round(cut * 30), cut * 30, delta=0.01)  # on a whole frame
        self.assertEqual(out[1][2], "8.0")                                # sped-up shot keeps its source range
        self.assertEqual(out[1][4], "0.5")

    def test_retime_slides_back_at_clip_end(self):
        out, _, problems = retime([["a.mov", "9.5", "0.5", "1"]], [4], 0.5, lambda f: 10.0)
        self.assertEqual(problems, [])
        self.assertAlmostEqual(float(out[0][1]) + float(out[0][2]), 9.95, delta=1e-3)
        _, _, problems = retime([["a.mov", "0", "0.5", "1"]], [4], 0.5, lambda f: 1.0)
        self.assertEqual(len(problems), 1)

    def test_beat_start(self):
        self.assertAlmostEqual(beat_start(40.0, 2.0, 0.3, 0.5), 39.8)  # beats at 39.8 and 40.3: the nearer one
        self.assertAlmostEqual(beat_start(40.0, 2.0, 0.1, 0.5), 40.1)
        self.assertEqual(beat_start(0.0, 0.0, 0.1, 0.5), 0.1)

    def test_tempo_of_a_click_track(self):
        sr, bpm = music.SR, 125.0
        x = np.zeros(int(sr * 12), dtype=np.float32)
        click = (np.hanning(200) * np.sin(np.arange(200) * 0.9)).astype(np.float32)
        for k in range(int(12 / (60 / bpm))):
            i = int((0.2 + k * 60 / bpm) * sr)
            x[i:i + 200] += click[: len(x[i:i + 200])]
        found, first, strength = music.tempo(x)
        self.assertAlmostEqual(found, bpm, delta=1.0)
        self.assertGreater(strength, 2)
        self.assertEqual(music.tempo(np.zeros(sr * 2, dtype=np.float32))[0], 0.0)
        loud = np.zeros(sr * 40, dtype=np.float32)
        loud[sr * 20: sr * 35] = 0.5
        self.assertEqual(music.loudest(loud), 20)


@unittest.skipUnless(FFMPEG, "ffmpeg not installed")
class MixTests(unittest.TestCase):
    def test_mix_adds_sound_keeps_picture_and_length(self):
        env = dict(os.environ, PATH=os.path.dirname(FFMPEG) + os.pathsep + os.environ.get("PATH", ""))
        ffprobe = os.path.join(os.path.dirname(FFMPEG), "ffprobe")
        with tempfile.TemporaryDirectory() as ws:
            video, track = os.path.join(ws, "cut.mp4"), os.path.join(ws, "song.mp3")
            subprocess.run([FFMPEG, "-v", "error", "-f", "lavfi", "-i", "testsrc=size=1080x1920:rate=30:duration=8", "-pix_fmt", "yuv420p",
                            "-c:v", "libx264", "-preset", "ultrafast", video], check=True, env=env)
            subprocess.run([FFMPEG, "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=30", track], check=True, env=env)
            r = subprocess.run(["bash", os.path.join(SCRIPTS, "mix.sh"), video, track, "12.5"], capture_output=True, text=True, env=env)
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
            probe = json.loads(subprocess.check_output([ffprobe, "-v", "error", "-show_entries", "stream=codec_type,width,height:format=duration",
                                                        "-of", "json", video]))
            kinds = sorted(s["codec_type"] for s in probe["streams"])
            self.assertEqual(kinds, ["audio", "video"])
            self.assertAlmostEqual(float(probe["format"]["duration"]), 8.0, delta=0.1)
            self.assertFalse(os.path.exists(os.path.join(ws, "cut.mix.mp4")))
            bad = subprocess.run(["bash", os.path.join(SCRIPTS, "mix.sh"), video, os.path.join(ws, "missing.mp3"), "0"], capture_output=True, text=True, env=env)
            self.assertNotEqual(bad.returncode, 0)


def _tone_db(ffmpeg, path, start, seconds, hz):
    """Level of one tone in a stretch of a file's sound, in dB (for telling the music from the voice)."""
    raw = subprocess.run([ffmpeg, "-v", "error", "-ss", str(start), "-t", str(seconds), "-i", path, "-vn", "-ac", "1", "-ar", "8000", "-f", "s16le", "-"],
                         capture_output=True).stdout
    x = np.frombuffer(raw, dtype=np.int16).astype(float) / 32768
    spec, freqs = np.abs(np.fft.rfft(x)), np.fft.rfftfreq(len(x), 1 / 8000)
    return 20 * np.log10(spec[(freqs > hz - 15) & (freqs < hz + 15)].sum() / len(x) + 1e-12)


@unittest.skipUnless(FFMPEG, "ffmpeg not installed")
class ClipSoundTests(unittest.TestCase):
    """A shot that keeps its clip's own sound (someone talking): held through fit and beatfit, heard in the mix."""

    def setUp(self):
        self.env = dict(os.environ, PATH=os.path.dirname(FFMPEG) + os.pathsep + os.environ.get("PATH", ""))
        self.tmp = tempfile.TemporaryDirectory()
        self.ws = self.tmp.name
        self.footage, self.work = os.path.join(self.ws, "footage"), os.path.join(self.ws, "work")
        os.makedirs(self.footage), os.makedirs(self.work)
        # talk.mp4: a 1000 Hz "voice"; action.mp4: still, then 3 seconds of movement and loud hits from 10s; no sound in mute.mp4
        subprocess.run([FFMPEG, "-v", "error", "-f", "lavfi", "-i", "color=c=gray:s=360x640:r=30:d=8", "-f", "lavfi", "-i", "sine=frequency=1000:duration=8",
                        "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", os.path.join(self.footage, "talk.mp4")], check=True, env=self.env)
        subprocess.run([FFMPEG, "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=360x640:r=30:d=10", "-f", "lavfi", "-i", "testsrc2=s=360x640:r=30:d=3",
                        "-f", "lavfi", "-i", "color=c=black:s=360x640:r=30:d=7",
                        "-f", "lavfi", "-i", "sine=f=80:d=20,volume='if(between(t,10,13),if(lt(mod(t,0.5),0.05),8,0.02),0.02)':eval=frame",
                        "-filter_complex", "[0][1][2]concat=n=3:v=1:a=0[v]", "-map", "[v]", "-map", "3:a", "-shortest",
                        "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", os.path.join(self.footage, "action.mp4")], check=True, env=self.env)
        subprocess.run([FFMPEG, "-v", "error", "-f", "lavfi", "-i", "testsrc=size=360x640:rate=30:duration=6", "-pix_fmt", "yuv420p",
                        "-c:v", "libx264", "-preset", "ultrafast", os.path.join(self.footage, "mute.mp4")], check=True, env=self.env)

    def tearDown(self):
        self.tmp.cleanup()

    def run_script(self, *args):
        cmd = (["bash"] if args[0].endswith(".sh") else [sys.executable]) + [os.path.join(SCRIPTS, args[0]), *args[1:]]
        return subprocess.run(cmd, capture_output=True, text=True, env=self.env)

    def test_fit_holds_long_shots_only_when_asked_and_never_scales_a_talking_shot(self):
        draft, out = os.path.join(self.work, "d.tsv"), os.path.join(self.work, "c.tsv")
        with open(draft, "w") as f:
            f.write("talk.mp4|1|4|1||1\naction.mp4|9.5|3|1\nmute.mp4|0.5|3|1\naction.mp4|14|3|1\n")
        quick = self.run_script("fit.py", self.footage, draft, "15", out)
        self.assertEqual(quick.returncode, 1)
        self.assertIn("pacing", quick.stdout)
        held = self.run_script("fit.py", self.footage, draft, "15", out, "held")
        self.assertEqual(held.returncode, 0, held.stdout + held.stderr)
        rows = [l.split("|") for l in open(out).read().split()]
        self.assertEqual(rows[0], ["talk.mp4", "1", "4", "1", "", "1"])  # the words are left whole
        self.assertAlmostEqual(sum(float(r[2]) for r in rows), 15.0, delta=0.01)
        with open(draft, "w") as f:  # a held cut chopped into one-second shots is refused too
            f.write("".join(f"action.mp4|{i * 1.5}|1|1\n" for i in range(10)))
        self.assertEqual(self.run_script("fit.py", self.footage, draft, "10", out, "held").returncode, 1)
        with open(draft, "w") as f:
            f.write("talk.mp4|1|4|2||1\n")
        self.assertNotEqual(self.run_script("fit.py", self.footage, draft, "4", out).returncode, 0)  # sound needs speed 1

    def test_beatfit_never_shortens_a_talking_shot(self):
        n = allocate_beats([3.1, 2.0, 2.0, 2.0], 0.5, 8, fixed={0})
        self.assertGreaterEqual(n[0] * 0.5, 3.1)
        self.assertEqual(allocate_beats([1.2, 0.4, 3.0, 2.1, 1.0], 0.5, 15), allocate_beats([1.2, 0.4, 3.0, 2.1, 1.0], 0.5, 15, fixed=()))

    def test_render_and_mix_keep_the_voice_and_lower_the_music_under_it(self):
        ffprobe = os.path.join(os.path.dirname(FFMPEG), "ffprobe")
        edl, out, track = os.path.join(self.work, "story-15.tsv"), os.path.join(self.ws, "story-15.mp4"), os.path.join(self.ws, "song.mp3")
        with open(edl, "w") as f:
            f.write("talk.mp4|1|4|1||1\naction.mp4|10|3|1\nmute.mp4|1|3|1||1\n")
        subprocess.run([FFMPEG, "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=30", track], check=True, env=self.env)
        r = self.run_script("render.sh", self.footage, edl, out)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("1 with their own sound", r.stdout)
        self.assertIn("WARN shot 3", r.stdout)  # mute.mp4 has no sound to keep
        voice = out.replace(".mp4", ".voice.wav")
        self.assertTrue(os.path.isfile(voice))
        self.assertTrue(os.path.isfile(out.replace(".mp4", ".review-1.jpg")))
        dur = lambda p: float(subprocess.check_output([ffprobe, "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", p]))
        self.assertAlmostEqual(dur(voice), dur(out), delta=0.02)
        m = self.run_script("mix.sh", out, track, "5")
        self.assertEqual(m.returncode, 0, m.stdout + m.stderr)
        self.assertAlmostEqual(dur(out), 10.0, delta=0.1)
        # The voice (1000 Hz) is there for the first shot only; the music (440 Hz) is clearly lower under it.
        self.assertGreater(_tone_db(FFMPEG, out, 0.5, 3, 1000), _tone_db(FFMPEG, out, 5, 3, 1000) + 20)
        self.assertLess(_tone_db(FFMPEG, out, 0.5, 3, 440), _tone_db(FFMPEG, out, 5, 3, 440) - 8)
        self.assertGreater(_tone_db(FFMPEG, out, 0.5, 3, 1000), _tone_db(FFMPEG, out, 0.5, 3, 440) + 6)
        # The measured check passes on this mix, and its report is left for the reviewer.
        music_wav, said_wav, report = (out.replace(".mp4", e) for e in (".music.wav", ".said.wav", ".sound.txt"))
        self.assertTrue(os.path.isfile(music_wav) and os.path.isfile(said_wav))
        ok = self.run_script("soundcheck.py", out)
        self.assertEqual(ok.returncode, 0, ok.stdout + ok.stderr)
        self.assertIn("ok voice over music", ok.stdout)
        self.assertIn("ok ending", ok.stdout)
        with open(report) as f:
            self.assertTrue(f.read().strip().endswith("PASS"))
        # Music as loud as the voice under the talking: a FIX that says how much lower to mix it.
        subprocess.run([FFMPEG, "-v", "error", "-y", "-i", said_wav, "-af", "volume=-2dB", "-c:a", "pcm_s16le", music_wav + ".tmp.wav"], check=True, env=self.env)
        os.replace(music_wav + ".tmp.wav", music_wav)
        loud = self.run_script("soundcheck.py", out)
        self.assertEqual(loud.returncode, 1, loud.stdout)
        self.assertRegex(loud.stdout, r"FIX voice over music.*mix\.sh <preview> <track> <audio_start> -\d+")
        self.assertIn("FAIL", loud.stdout)
        # Mixing again with the music turned down is accepted, and a bad number is refused.
        self.assertEqual(self.run_script("mix.sh", out, track, "5", "-6").returncode, 0)
        self.assertEqual(self.run_script("soundcheck.py", out).returncode, 0)
        self.assertNotEqual(self.run_script("mix.sh", out, track, "5", "loud").returncode, 0)
        # No music at all: the shot's own sound alone.
        self.assertEqual(self.run_script("render.sh", self.footage, edl, out).returncode, 0)
        only = self.run_script("mix.sh", out, "none", "0")
        self.assertEqual(only.returncode, 0, only.stdout + only.stderr)
        self.assertGreater(_tone_db(FFMPEG, out, 0.5, 3, 1000), _tone_db(FFMPEG, out, 5, 3, 1000) + 20)
        # Without a shot that keeps its sound there is no voice file, and `none` has nothing to mix.
        with open(edl, "w") as f:
            f.write("action.mp4|10|3|1\n")
        self.assertEqual(self.run_script("render.sh", self.footage, edl, out).returncode, 0)
        self.assertFalse(os.path.exists(voice))
        self.assertNotEqual(self.run_script("mix.sh", out, "none", "0").returncode, 0)
        # A preview nobody mixed has no sound to measure, and music that stops dead is caught.
        silent = self.run_script("soundcheck.py", out)
        self.assertEqual(silent.returncode, 1, silent.stdout)
        self.assertIn("no sound in this cut", silent.stdout)
        dead = os.path.join(self.ws, "dead.mp4")
        subprocess.run([FFMPEG, "-v", "error", "-y", "-i", out, "-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-map", "0:v:0", "-map", "1:a:0",
                        "-c:v", "copy", "-af", "loudnorm=I=-14:TP=-1.5", "-c:a", "aac", "-shortest", dead], check=True, env=self.env)
        stop = self.run_script("soundcheck.py", dead)
        self.assertEqual(stop.returncode, 1, stop.stdout)
        self.assertIn("it stops dead", stop.stdout)
        self.assertEqual(step_label("Bash", {"command": "python3 $SK/soundcheck.py out/previews/story-15.mp4"}), "Checking the sound of the 15s story")

    def test_edl_round_trip_keeps_the_sound_flag(self):
        edl = os.path.join(self.work, "c.tsv")
        with open(edl, "w") as f:
            f.write("talk.mp4|1|4|1||1\naction.mp4|10|3|1|0.5\nmute.mp4|1|3|1\n")
        entries = json.loads(self.run_script("edl2json.py", "json", edl).stdout)
        self.assertEqual([e.get("sound") for e in entries], [True, None, None])
        prev = os.path.join(self.work, "previous.json")
        with open(prev, "w") as f:
            json.dump({"cuts": [{"id": "story-15", "edl": entries}]}, f)
        back = os.path.join(self.work, "back.tsv")
        self.assertEqual(self.run_script("edl2json.py", "tsv", prev, "story-15", back).returncode, 0)
        self.assertEqual(json.loads(self.run_script("edl2json.py", "json", back).stdout), entries)

    def test_moments_finds_the_action_and_sampling_can_look_closely(self):
        m = self.run_script("moments.py", self.footage, os.path.join(self.work, "moments"))
        self.assertEqual(m.returncode, 0, m.stdout + m.stderr)
        rows = [l.split("\t") for l in open(os.path.join(self.work, "moments", "moments.tsv")).read().splitlines()[1:]]
        best = max((r for r in rows if r[0] == "action.mp4"), key=lambda r: float(r[3]))
        self.assertTrue(9 <= int(best[1]) <= 11, best)  # the movement and hits are at 10-13s
        self.assertNotIn("mute.mp4", {r[0] for r in rows})  # under 8s: nothing to find
        s = subprocess.run(["bash", os.path.join(SCRIPTS, "sample.sh"), self.footage, os.path.join(self.work, "samples")],
                           input="action.mp4\naction.mp4|10|13\n", capture_output=True, text=True, env=self.env)
        self.assertEqual(s.returncode, 0, s.stdout + s.stderr)
        lines = [l for l in s.stdout.splitlines() if l.startswith("row")]
        self.assertEqual(len(lines[0].split(":")[1].split()), 10)                      # a 20s clip: ten frames, one every 2s
        zoom = [float(t) for t in lines[1].split(":")[1].split()]
        self.assertEqual(len(zoom), 10)
        self.assertTrue(all(10 <= t <= 13 for t in zoom))
        self.assertTrue(os.path.isfile(os.path.join(self.work, "samples", "sheet1.jpg")))

    def test_listen_never_fails_the_job(self):
        r = self.run_script("listen.py", self.footage, os.path.join(self.work, "listen"))
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertTrue(os.path.isfile(os.path.join(self.work, "listen", "speech.tsv")))


class HistoryAndSoundContractTests(unittest.TestCase):
    def test_history_reaches_the_brief(self):
        job = dict(JOB, kind="revision", previous={"manifest": {"cuts": []}}, history=["open with him talking", "  ", "no choppy cuts"])
        self.assertIsNotNone(valid_job(job))
        files = clip_filenames(job["clips"])
        self.assertEqual(job_brief(job, files)["history"], ["open with him talking", "no choppy cuts"])
        self.assertIn("history", build_prompt(job, files, "cutting-montage-videos"))
        self.assertEqual(job_brief(dict(JOB), files)["history"], [])
        self.assertIsNone(valid_job(dict(JOB, history="x")))
        self.assertIsNone(valid_job(dict(JOB, history=[1])))
        self.assertIsNone(valid_job(dict(JOB, history=["x"] * 31)))

    def test_manifest_keeps_the_sound_flag(self):
        files = clip_filenames(CLIPS)
        raw = good_manifest()
        raw["cuts"][0]["edl"][0]["sound"] = True
        cut = validate_manifest(raw, files)["cuts"][0]
        self.assertIs(cut["edl"][0].get("sound"), True)
        self.assertTrue(all("sound" not in e for e in cut["edl"][1:]))
        raw["cuts"][0]["edl"][0]["speed"] = 2
        with self.assertRaises(ManifestError):
            validate_manifest(raw, files)
        raw["cuts"][0]["edl"][0].update(speed=1, sound="yes")
        with self.assertRaises(ManifestError):
            validate_manifest(raw, files)

    def test_new_step_labels(self):
        self.assertEqual(step_label("Bash", {"command": "python3 $SK/listen.py footage work/listen"}), "Listening for people talking")
        self.assertEqual(step_label("Bash", {"command": "python3 $SK/moments.py footage work/moments"}), "Finding the action")
        self.assertEqual(step_label("Bash", {"command": "bash $SK/mix.sh out/previews/story-15.mp4 none 0"}), "Adding the sound to the 15s story")
        self.assertEqual(step_label("Read", {"file_path": "out/previews/reel-30.review-2.jpg"}), "Checking the 30s reel")
        self.assertIsNone(bash_denial("printf '%s\\n' 'a.mov|41|47' | bash $SK/sample.sh footage work/samples/zoom-1", "/tmp/ws"))



# ---- Epidemic Sound ------------------------------------------------------------------------------

REC_ID = "bc654f2f-4b61-4278-8f98-2cfb5c3aad7b"
RECORDING = {
    "id": REC_ID, "title": "Summer Knot (Instrumental)", "bpm": 105,
    "audioFile": {"durationInMilliseconds": 192463, "lqmp3Url": "https://audiocdn.epidemicsound.com/lqmp3/x.mp3"},
    "credits": [{"role": "COMPOSER", "artist": {"name": "Someone Else"}}, {"role": "MAIN_ARTIST", "artist": {"name": "American Legion"}}],
    "tags": [{"displayName": "hopeful", "dimension": {"name": "mood"}}, {"displayName": "tropical house", "dimension": {"name": "genre"}}],
}
ASSET = "https://audiocdn.epidemicsound.com/audiofiles/mp3/x.mp3?signature=s3cret"


class FakeResponse:
    def __init__(self, body: bytes, headers=None):
        self._body, self._at, self.headers = body, 0, headers or {}

    def read(self, n=-1):
        chunk = self._body[self._at:] if n < 0 else self._body[self._at:self._at + n]
        self._at += len(chunk)
        return chunk

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class FakeEpidemic:
    """Stands in for Epidemic Sound's MCP server and its file host. Records what it was sent."""

    def __init__(self, audio=b"ID3" + b"x" * 5000, asset=ASSET, search_error=None):
        self.calls, self.auth, self.audio, self.asset, self.search_error = [], set(), audio, asset, search_error

    def __call__(self, req, timeout):
        if req.get_method() == "GET":
            self.calls.append(("GET", req.full_url))
            assert req.get_header("Authorization") is None  # the key never goes to the file host
            return FakeResponse(self.audio)
        self.auth.add(req.get_header("Authorization"))
        msg = json.loads(req.data)
        self.calls.append((msg["method"], (msg.get("params") or {}).get("name")))
        if msg["method"] == "initialize":
            return FakeResponse(b'data: \n\ndata: {"jsonrpc":"2.0","id":1,"result":{}}\n\n', {"Mcp-Session-Id": "sess-1"})
        if msg["method"] == "notifications/initialized":
            return FakeResponse(b"")
        assert req.get_header("Mcp-session-id") == "sess-1"
        args = msg["params"]["arguments"]
        if msg["params"]["name"] == "SearchRecordings":
            self.last_search = args
            data = {"errors": [{"message": self.search_error, "extensions": {"code": "RETRY_LATER"}}]} if self.search_error else \
                {"data": {"recordings": {"nodes": [{"recording": RECORDING}, {"recording": {"id": "nope", "title": "bad id"}}]}}}
        else:
            data = {"data": {"recordingDownload": {"assetUrl": self.asset}}}
        result = {"jsonrpc": "2.0", "id": msg["id"], "result": {"content": [{"type": "text", "text": json.dumps(data)}], "isError": False}}
        return FakeResponse(("data: " + json.dumps(result) + "\n\n").encode())


class EpidemicTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="es-test-")
        self.addCleanup(shutil.rmtree, self.dir, True)

    def finder(self, server, **kw):
        return MusicFinder(EpidemicClient("es-key-123", opener=server), self.dir, **kw)

    def test_search_returns_compact_tracks_and_sends_filters(self):
        server = FakeEpidemic()
        out = json.loads(self.finder(server).search({"term": " upbeat summer ", "bpmMin": 100, "bpmMax": 130, "vocals": False, "count": 50}))
        self.assertEqual(out["tracks"], [{"id": REC_ID, "title": "Summer Knot (Instrumental)", "artist": "American Legion", "bpm": 105,
                                          "seconds": 192.5, "tags": ["hopeful", "tropical house"]}])
        self.assertEqual((out["searchesLeft"], out["downloadsLeft"]), (11, 4))
        self.assertEqual(server.last_search, {"query": {"term": "upbeat summer"}, "first": 10, "filter": {"bpm": {"min": 100, "max": 130}, "vocals": False}})
        self.assertEqual(server.auth, {"Bearer es-key-123"})
        self.assertNotIn("http", json.dumps(out))  # no preview or cover links reach the agent

    def test_download_saves_into_music_and_records_the_track(self):
        server = FakeEpidemic()
        f = self.finder(server)
        f.search({"term": "summer"})
        out = json.loads(f.download({"id": REC_ID.upper()}))
        name = track_filename("Summer Knot (Instrumental)", REC_ID)
        self.assertEqual(name, "es-summer-knot-instrumental-bc654f2f.mp3")
        self.assertEqual(out["file"], f"music/{name}")
        with open(os.path.join(self.dir, name), "rb") as fh:
            self.assertEqual(fh.read(), server.audio)
        self.assertEqual(f.downloaded, {name: {"recordingId": REC_ID, "title": "Summer Knot (Instrumental)", "seconds": 192.5, "bpm": 105}})
        self.assertNotIn("s3cret", json.dumps(out))
        before = len(server.calls)
        self.assertEqual(json.loads(f.download({"id": REC_ID}))["file"], f"music/{name}")  # asked twice: the same file, no second download
        self.assertEqual(len(server.calls), before)

    def test_limits_and_bad_input(self):
        f = self.finder(FakeEpidemic(), max_searches=1, max_downloads=0)
        for bad in ({}, {"term": ""}, {"term": 5}, {"term": "x" * 201}):
            with self.assertRaises(EpidemicError):
                f.search(bad)
        with self.assertRaises(EpidemicError):
            f.download({"id": REC_ID})  # not from a search in this job
        f.search({"term": "summer"})
        with self.assertRaises(EpidemicError):
            f.search({"term": "again"})
        with self.assertRaises(EpidemicError):
            f.download({"id": REC_ID})  # no downloads left
        self.assertEqual(os.listdir(self.dir), [])

    def test_refuses_a_link_off_epidemic_sound_and_an_oversize_file(self):
        for asset in ("https://evil.example/x.mp3", "http://audiocdn.epidemicsound.com/x.mp3", "https://notepidemicsound.com/x.mp3"):
            f = self.finder(FakeEpidemic(asset=asset))
            f.search({"term": "summer"})
            with self.assertRaises(EpidemicError):
                f.download({"id": REC_ID})
        f = self.finder(FakeEpidemic(audio=b"x" * (epidemic.MAX_TRACK_BYTES + 1)))
        f.search({"term": "summer"})
        with self.assertRaises(EpidemicError):
            f.download({"id": REC_ID})
        self.assertEqual((os.listdir(self.dir), f.downloaded), ([], {}))

    def test_errors_are_safe_to_show(self):
        with self.assertRaises(EpidemicError) as ctx:
            self.finder(FakeEpidemic(search_error="Try later, see https://internal.example/secret")).search({"term": "summer"})
        self.assertIn("RETRY_LATER", str(ctx.exception))
        self.assertNotIn("http", str(ctx.exception))

        def rejected(req, timeout):
            raise epidemic.urllib.error.HTTPError(req.full_url, 401, "Unauthorized", {}, None)
        with self.assertRaises(EpidemicError) as ctx:
            self.finder(rejected).search({"term": "summer"})
        self.assertNotIn("es-key-123", str(ctx.exception))
        self.assertIsNone(compact({"id": "not-a-uuid", "title": "x"}))

    def test_job_brief_prompt_and_steps(self):
        job = dict(copy.deepcopy(JOB), epidemicSoundApiKey="es-key-123")
        self.assertIsNotNone(valid_job(job))
        self.assertIsNone(valid_job(dict(job, epidemicSoundApiKey=5)))
        self.assertIsNotNone(valid_job(dict(job, epidemicSoundApiKey=None)))
        files = clip_filenames(job["clips"])
        brief, prompt = job_brief(job, files), build_prompt(job, files, "cutting-montage-videos")
        self.assertIs(brief["epidemicSound"], True)
        self.assertIs(job_brief(JOB, files)["epidemicSound"], False)
        self.assertNotIn("es-key-123", json.dumps(brief) + prompt)
        self.assertIn("epidemic-sound.md", prompt)
        self.assertNotIn("Epidemic", build_prompt(JOB, files, "cutting-montage-videos"))
        self.assertEqual(step_label(epidemic.SEARCH_TOOL, {"term": "x"}), "Searching Epidemic Sound for music")
        self.assertEqual(step_label(epidemic.DOWNLOAD_TOOL, {"id": "x"}), "Getting a track from Epidemic Sound")

    def test_manifest_accepts_a_downloaded_track_as_a_new_track(self):
        files = clip_filenames(CLIPS)
        name = track_filename("Summer Knot", REC_ID)
        downloaded = {name: {"recordingId": REC_ID, "title": "Summer Knot", "seconds": 192.5, "bpm": 105}}
        m = good_manifest()
        m["cuts"][0]["music"] = {"file": f"music/{name}", "start": 41.2184}
        with self.assertRaises(ManifestError):
            validate_manifest(m, files, set(), music_filenames(TRACKS))  # not downloaded by this job
        cut = validate_manifest(m, files, set(), music_filenames(TRACKS), None, downloaded)["cuts"][0]
        self.assertEqual(cut["music"], {"newTrack": {"file": name, "recordingId": REC_ID, "title": "Summer Knot", "seconds": 192.5, "bpm": 105}, "start": 41.218})
        m["cuts"][0]["music"] = {"file": music_filenames(TRACKS)[0][0], "start": 3}
        self.assertEqual(validate_manifest(m, files, set(), music_filenames(TRACKS), None, downloaded)["cuts"][0]["music"], {"trackId": "t1", "start": 3.0})



if __name__ == "__main__":
    unittest.main(verbosity=1)
