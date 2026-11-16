"""
Nekter cloud video editor on Modal: headless Claude Code (Claude Agent SDK, Python) with the cloud copy of the
owner's editing skill (skill/ next to this file) cuts vertical videos from a job's clips and reports back.

POST <submit>  Authorization: Bearer <MODAL_EDITOR_SECRET>   (job contract: contract.valid_job)
answers 202 straight away and spawns `run_job`, which:
  fresh temp workspace -> streams the clips to footage/ (presigned GETs) -> runs the agent (cwd = workspace,
  skill in .claude/skills/, allow-listed tools, dontAsk, 80 turns, 25 min) -> validates out/manifest.json ->
  uploads previews (uploads endpoint + presigned PUTs) -> POSTs the callback signed with
  X-Nekter-Signature = hex HMAC-SHA256(raw body, MODAL_EDITOR_SECRET).

The workspace's Anthropic key lives only in the agent process's environment: never logged, written or sent back.
Logs carry the job id, counts and tool names only: no URLs, filenames, prompts or clip contents.

Deploy: see README.md next to this file.
"""
from __future__ import annotations

import asyncio
import hmac
import json
import os
import shutil
import subprocess
import tempfile
import time
from typing import Any, Dict, List, Optional, Tuple

import modal

SECRET_NAME = "nekter-editor"
SKILL_NAME = "cutting-montage-videos"
SKILL_DIR = "/opt/nekter/skill"
TIMEOUT_SEC = 30 * 60
AGENT_MAX_SEC = 25 * 60
MAX_TURNS = 80
MAX_FOOTAGE_BYTES = 40 * 1024**3
MAX_PUT_BYTES = 5 * 1024**3
CHUNK = 8 * 1024 * 1024
TOOLS = ["Read", "Write", "Edit", "Glob", "Grep", "Bash", "Skill"]
FILE_TOOLS = ("Read", "Write", "Edit", "Glob", "Grep")

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("ffmpeg")
    # Fail the image build, not a job, if Debian's ffmpeg lacks what the scripts need.
    .run_commands(
        "ffmpeg -hide_banner -encoders | grep -q libx264",
        "ffmpeg -hide_banner -filters | grep -qw tile",
        "command -v awk && command -v bash",
    )
    # The SDK wheel bundles the Claude Code binary, so no Node.js is needed.
    .pip_install("claude-agent-sdk==0.2.182", "fastapi[standard]==0.115.12", "requests==2.32.3")
    .run_commands("python -c 'import claude_agent_sdk'")
    .add_local_python_source("contract")
    .add_local_dir(os.path.join(os.path.dirname(os.path.abspath(__file__)), "skill"), SKILL_DIR)
)

app = modal.App("nekter-editor", image=image)
secret = modal.Secret.from_name(SECRET_NAME, required_keys=["MODAL_EDITOR_SECRET"])

with image.imports():
    import requests
    from fastapi import Request
    from fastapi.responses import JSONResponse

    from contract import (
        ManifestError, bash_denial, build_prompt, clip_filenames, extract_usage, job_brief, path_denial,
        preview_path, previous_for_agent, previous_keys, sign, valid_job, validate_manifest,
    )


class JobError(Exception):
    """A failure whose message is safe to send back (no URLs, no key)."""


_SECRET: Optional[str] = None


def _secret() -> str:
    """Read once, then removed from the environment so the agent's processes never inherit it."""
    global _SECRET
    if _SECRET is None:
        value = os.environ.pop("MODAL_EDITOR_SECRET", "").strip()
        if not value:
            raise RuntimeError("MODAL_EDITOR_SECRET is not set")
        _SECRET = value
    return _SECRET


@app.function(secrets=[secret], timeout=60)
@modal.fastapi_endpoint(method="POST")
async def submit(request: Request):
    expected = f"Bearer {_secret()}".encode()
    if not hmac.compare_digest(request.headers.get("authorization", "").encode(), expected):
        return JSONResponse({"error": "forbidden"}, status_code=403)
    try:
        job = valid_job(await request.json())
    except ValueError:
        job = None
    if job is None:
        return JSONResponse({"error": "invalid job"}, status_code=400)
    run_job.spawn(job)
    return JSONResponse({"accepted": True, "jobId": job["jobId"]}, status_code=202)


# ---- files in and out --------------------------------------------------------------------------


def _download_all(clips: List[Dict[str, Any]], files: List[Tuple[str, str]], footage: str) -> None:
    total = 0
    for clip, (name, _) in zip(clips, files):
        try:
            with requests.get(clip["url"], stream=True, timeout=(15, 120)) as res:
                if res.status_code != 200:
                    raise JobError(f"A clip could not be downloaded (HTTP {res.status_code}).")
                with open(os.path.join(footage, name), "wb") as f:
                    for chunk in res.iter_content(CHUNK):
                        total += len(chunk)
                        if total > MAX_FOOTAGE_BYTES:
                            raise JobError("The clips are over 40 GB together.")
                        f.write(chunk)
        except requests.RequestException as err:
            raise JobError(f"A clip could not be downloaded ({type(err).__name__}).") from None


def _probe_preview(path: str) -> Tuple[int, int, float]:
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration",
                          "-of", "json", path], capture_output=True, text=True, timeout=60)
    if out.returncode != 0:
        raise ManifestError("A preview could not be read as a video.")
    j = json.loads(out.stdout)
    s = (j.get("streams") or [{}])[0]
    return int(s.get("width") or 0), int(s.get("height") or 0), float((j.get("format") or {}).get("duration") or 0)


def _upload_previews(job: Dict[str, Any], cuts: List[Dict[str, Any]], ws: str) -> None:
    """Replaces each local preview {path} with the {key} the uploads endpoint returned, after a presigned PUT."""
    todo = []
    for cut in cuts:
        if "path" not in cut["preview"]:
            continue
        path = preview_path(ws, cut["preview"]["path"])
        w, h, dur = _probe_preview(path)
        if (w, h) != (1080, 1920):
            raise ManifestError(f"The preview for {cut['id']} is {w}x{h}, not 1080x1920.")
        if abs(dur - cut["seconds"]) > 1.0:
            raise ManifestError(f"The preview for {cut['id']} is {dur:.1f}s, not {cut['seconds']:.0f}s.")
        if os.path.getsize(path) > MAX_PUT_BYTES:
            raise ManifestError(f"The preview for {cut['id']} is over 5 GB.")
        todo.append((cut, f"{cut['id']}.mp4", path))
    if not todo:
        return
    try:
        res = requests.post(job["uploads"]["url"], json={"files": [{"name": n, "contentType": "video/mp4"} for _, n, _ in todo]},
                            headers={"Authorization": f"Bearer {_secret()}"}, timeout=30)
    except requests.RequestException as err:
        raise JobError(f"Upload links could not be fetched ({type(err).__name__}).") from None
    if res.status_code != 200:
        raise JobError(f"Upload links could not be fetched (HTTP {res.status_code}).")
    try:
        given = {f["name"]: f for f in res.json()["files"] if isinstance(f.get("key"), str) and str(f.get("putUrl", "")).startswith("https://")}
    except (ValueError, KeyError, TypeError, AttributeError):
        raise JobError("The upload links came back in an unexpected shape.") from None
    for cut, name, path in todo:
        if name not in given:
            raise JobError("An upload link is missing.")
        size = os.path.getsize(path)
        try:
            with open(path, "rb") as f:
                put = requests.put(given[name]["putUrl"], data=f, headers={"Content-Type": "video/mp4", "Content-Length": str(size)}, timeout=(15, 600))
        except requests.RequestException as err:
            raise JobError(f"A preview upload failed ({type(err).__name__}).") from None
        if put.status_code not in (200, 201):
            raise JobError(f"A preview upload failed (HTTP {put.status_code}).")
        cut["preview"] = {"key": given[name]["key"]}


def _callback(url: str, payload: Dict[str, Any]) -> None:
    body = json.dumps(payload, separators=(",", ":")).encode()
    headers = {"Content-Type": "application/json", "X-Nekter-Signature": sign(_secret(), body)}
    for attempt in range(4):
        try:
            res = requests.post(url, data=body, headers=headers, timeout=30)
            if res.status_code < 500:
                if res.status_code >= 300:
                    print(f"callback refused: HTTP {res.status_code}")
                return
        except requests.RequestException as err:
            print(f"callback attempt {attempt + 1} failed: {type(err).__name__}")
        time.sleep(2 * 2**attempt)


# ---- the agent ---------------------------------------------------------------------------------


def _agent_env(api_key: str, tmp: str) -> Dict[str, str]:
    """Merged over the inherited environment (per the SDK docs), so anything sensitive inherited is blanked."""
    home = os.path.join(tmp, "home")
    os.makedirs(home, exist_ok=True)
    env = {k: "" for k in os.environ if k.startswith("MODAL_") or any(s in k.upper() for s in ("SECRET", "TOKEN", "PASSWORD", "_KEY"))}
    env.update({
        "ANTHROPIC_API_KEY": api_key,
        "HOME": home,
        "CLAUDE_CONFIG_DIR": os.path.join(home, ".claude"),  # VERIFY: Claude Code honours CLAUDE_CONFIG_DIR (sessions land in the temp dir either way via HOME)
        "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
        "CLAUDE_AGENT_SDK_CLIENT_APP": "nekter-editor/1",
    })
    return env


async def _run_agent(ws: str, tmp: str, prompt: str, model: str, api_key: str, budget_sec: float, state: Dict[str, Any]) -> Optional[str]:
    """Runs the agent. Fills state["result"] (the ResultMessage) and state["tokens"] as it goes, so they survive
    an exception; returns a safe error message or None."""
    from claude_agent_sdk import AssistantMessage, ClaudeAgentOptions, ClaudeSDKClient, HookMatcher, ResultMessage

    async def guard(input_data: Dict[str, Any], tool_use_id: Optional[str], context: Any) -> Dict[str, Any]:
        name = input_data.get("tool_name")
        tool_input = input_data.get("tool_input") or {}
        if name not in TOOLS:
            reason = "That tool is not available here."
        elif name == "Bash":
            reason = bash_denial(tool_input.get("command"), ws)
        elif name in FILE_TOOLS:
            reason = path_denial(name, tool_input, ws)
        else:
            reason = None
        print(f"tool {name}{' (refused)' if reason else ''}")
        if reason:
            return {"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": reason}}
        return {}

    options = ClaudeAgentOptions(
        tools=TOOLS,                       # the only built-in tools the agent sees
        allowed_tools=TOOLS,               # pre-approved; everything else is denied by dontAsk
        permission_mode="dontAsk",         # headless: any call that would prompt is denied
        hooks={"PreToolUse": [HookMatcher(hooks=[guard], on_failure="block")]},  # keeps every call inside the workspace
        cwd=ws,
        setting_sources=["project"],       # only <ws>/.claude (the skill); no user settings
        skills=[SKILL_NAME],
        model=model,
        max_turns=MAX_TURNS,
        env=_agent_env(api_key, tmp),
        stderr=lambda _line: None,         # never echo CLI output into logs
    )
    err = None
    tokens: Dict[str, int] = state["tokens"]
    seen: set = set()

    async with ClaudeSDKClient(options=options) as client:
        async def consume() -> None:
            async for msg in client.receive_response():
                if isinstance(msg, AssistantMessage) and msg.usage and msg.message_id not in seen:
                    seen.add(msg.message_id)
                    tokens["inputTokens"] += int(msg.usage.get("input_tokens") or 0)
                    tokens["outputTokens"] += int(msg.usage.get("output_tokens") or 0)
                    tokens["cacheReadTokens"] += int(msg.usage.get("cache_read_input_tokens") or 0)
                    tokens["turns"] += 1
                elif isinstance(msg, ResultMessage):
                    state["result"] = msg

        await client.query(prompt)
        try:
            await asyncio.wait_for(consume(), timeout=budget_sec)
        except asyncio.TimeoutError:
            err = "The edit ran out of time."
            try:  # stop the agent and collect the final result (with its cost)
                await client.interrupt()
                await asyncio.wait_for(consume(), timeout=60)
            except Exception:
                pass
    result = state["result"]
    if result is not None and getattr(result, "is_error", False) and err is None:
        sub = getattr(result, "subtype", "") or ""
        err = "The edit hit its turn limit." if sub == "error_max_turns" else f"The editor stopped with an error ({sub or 'unknown'})."
    return err


# ---- the job -----------------------------------------------------------------------------------


def _workspace(tmp: str, job: Dict[str, Any], files: List[Tuple[str, str]]) -> str:
    ws = os.path.join(tmp, "job")
    for d in ("footage", "work", "out/previews", ".claude/skills"):
        os.makedirs(os.path.join(ws, d), exist_ok=True)
    shutil.copytree(SKILL_DIR, os.path.join(ws, ".claude", "skills", SKILL_NAME))
    with open(os.path.join(ws, "job.json"), "w") as f:
        json.dump(job_brief(job, files), f, indent=2)
    if job.get("previous"):
        with open(os.path.join(ws, "previous.json"), "w") as f:
            json.dump(previous_for_agent(job["previous"]["manifest"], files), f, indent=2)
    return ws


@app.function(secrets=[secret], cpu=8.0, memory=16384, timeout=TIMEOUT_SEC, retries=0)
def run_job(job: Dict[str, Any]) -> None:
    started = time.monotonic()
    _secret()
    out: Dict[str, Any] = {"jobId": job["jobId"], "ok": False, "error": None, "manifest": None,
                           "reply": "Something went wrong while editing, so there is nothing new to watch yet.", "question": None}
    state: Dict[str, Any] = {"result": None, "tokens": {"inputTokens": 0, "outputTokens": 0, "cacheReadTokens": 0, "turns": 0}}
    agent_sec = 0.0
    try:
        with tempfile.TemporaryDirectory(prefix="editor-") as tmp:
            files = clip_filenames(job["clips"])
            ws = _workspace(tmp, job, files)
            _download_all(job["clips"], files, os.path.join(ws, "footage"))
            print(f"job {job['jobId']}: {len(files)} clips downloaded in {time.monotonic() - started:.0f}s")

            budget = min(AGENT_MAX_SEC, TIMEOUT_SEC - (time.monotonic() - started) - 240)
            if budget < 120:
                raise JobError("Downloading the clips took too long to leave time for editing.")
            agent_start = time.monotonic()
            try:
                agent_err = asyncio.run(
                    _run_agent(ws, tmp, build_prompt(job, files, SKILL_NAME), job["model"], job["anthropicApiKey"], budget, state))
            except Exception as err:  # never send a raw message: it could carry CLI output
                agent_err = f"The editor could not run ({type(err).__name__})."
            agent_sec = time.monotonic() - agent_start

            manifest_file = os.path.join(ws, "out", "manifest.json")
            if not os.path.isfile(manifest_file):
                raise JobError(agent_err or "The editor finished without a result.")
            try:
                with open(manifest_file) as f:
                    raw = json.load(f)
            except (ValueError, OSError):
                raise JobError("The editor's result was not valid JSON.") from None
            checked = validate_manifest(raw, files, previous_keys(job.get("previous")))
            _upload_previews(job, checked["cuts"], ws)
            out.update(ok=True, manifest={"cuts": checked["cuts"]} if checked["cuts"] else None,
                       reply=checked["reply"], question=checked["question"])
    except (JobError, ManifestError) as err:
        out["error"] = str(err)
    except Exception as err:
        out["error"] = f"Unexpected error ({type(err).__name__})."
    result = state["result"]
    duration_ms = getattr(result, "duration_ms", None) if result is not None else None
    out["usage"] = extract_usage(result, duration_ms / 1000 if duration_ms else agent_sec, state["tokens"])
    print(json.dumps({"jobId": out["jobId"], "ok": out["ok"], "error": out["error"], "cuts": len((out["manifest"] or {}).get("cuts", [])), "usage": out["usage"]}))
    _callback(job["callbackUrl"], out)
