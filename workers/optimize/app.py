"""
Nekter clip optimizer on Modal: shrinks every uploaded clip once, on arrival.

POST <endpoint>  Authorization: Bearer <MODAL_OPTIMIZE_SECRET>
  { jobId, mediaId, sourceUrl, outputUrl, callbackUrl }
answers 202 straight away and spawns `optimize`, which:
  downloads the source (presigned GET, streamed to disk) -> ffprobe -> plan (target.py) ->
  ffmpeg -> uploads the result (presigned PUT, one streamed request) -> POSTs the callback
  { jobId, mediaId, ok, sizeBytes, width, height, durationSec, codec, error? }
  signed with X-Nekter-Signature = hex HMAC-SHA256(raw body, MODAL_OPTIMIZE_SECRET).

The worker only ever holds presigned links: no storage keys, no database, no other secrets.
Errors reported back never include URLs.

Deploy: see README.md next to this file.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import subprocess
import tempfile
import time
from typing import Any, Dict, Optional

import modal

SECRET_NAME = "nekter-optimize"
TIMEOUT_SEC = 30 * 60
MAX_PUT_BYTES = 5 * 1024**3  # R2's limit for a single PUT
CHUNK = 8 * 1024 * 1024

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("ffmpeg")
    # Fail the image build, not a job, if Debian's ffmpeg lacks what the plan needs.
    .run_commands(
        "ffmpeg -hide_banner -encoders | grep -q libx265",
        "ffmpeg -hide_banner -filters | grep -qw zscale",
        "ffmpeg -hide_banner -filters | grep -qw tonemap",
    )
    .pip_install("fastapi[standard]==0.115.12", "requests==2.32.3")
    .add_local_python_source("target")
)

app = modal.App("nekter-optimize", image=image)
secret = modal.Secret.from_name(SECRET_NAME, required_keys=["MODAL_OPTIMIZE_SECRET"])

with image.imports():
    import requests
    from fastapi import Request
    from fastapi.responses import JSONResponse

    from target import copy_args, encode_args, plan_target, summarize_probe


class JobError(Exception):
    """A failure whose message is safe to send back (no URLs)."""


def _secret() -> str:
    value = os.environ.get("MODAL_OPTIMIZE_SECRET", "").strip()
    if not value:
        raise RuntimeError("MODAL_OPTIMIZE_SECRET is not set")
    return value


def _valid_job(job: Any) -> Optional[Dict[str, str]]:
    keys = ("jobId", "mediaId", "sourceUrl", "outputUrl", "callbackUrl")
    if not isinstance(job, dict) or not all(isinstance(job.get(k), str) and 0 < len(job[k]) < 8192 for k in keys):
        return None
    if not all(job[k].startswith("https://") for k in ("sourceUrl", "outputUrl", "callbackUrl")):
        return None
    return {k: job[k] for k in keys}


@app.function(secrets=[secret], timeout=60)
@modal.fastapi_endpoint(method="POST")
async def submit(request: Request):
    expected = f"Bearer {_secret()}".encode()
    if not hmac.compare_digest(request.headers.get("authorization", "").encode(), expected):
        return JSONResponse({"error": "forbidden"}, status_code=403)
    try:
        job = _valid_job(await request.json())
    except ValueError:
        job = None
    if job is None:
        return JSONResponse({"error": "invalid job"}, status_code=400)
    optimize.spawn(job)
    return JSONResponse({"accepted": True, "jobId": job["jobId"]}, status_code=202)


def _download(url: str, path: str) -> int:
    try:
        with requests.get(url, stream=True, timeout=(15, 120)) as res:
            if res.status_code != 200:
                raise JobError(f"Download failed (HTTP {res.status_code}).")
            size = 0
            with open(path, "wb") as f:
                for chunk in res.iter_content(CHUNK):
                    f.write(chunk)
                    size += len(chunk)
            return size
    except requests.RequestException as err:
        raise JobError(f"Download failed ({type(err).__name__}).") from None


def _upload(url: str, path: str) -> int:
    size = os.path.getsize(path)
    if size > MAX_PUT_BYTES:
        raise JobError("The optimized file is over 5 GB.")
    try:
        with open(path, "rb") as f:
            res = requests.put(url, data=f, headers={"Content-Type": "video/mp4", "Content-Length": str(size)}, timeout=(15, 600))
    except requests.RequestException as err:
        raise JobError(f"Upload failed ({type(err).__name__}).") from None
    if res.status_code not in (200, 201):
        raise JobError(f"Upload failed (HTTP {res.status_code}).")
    return size


def _probe(path: str) -> Dict[str, Any]:
    out = subprocess.run(["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", path], capture_output=True, text=True, timeout=120)
    if out.returncode != 0:
        raise JobError("The file could not be read as a video.")
    return json.loads(out.stdout)


def _ffmpeg(args: list, timeout: float) -> None:
    try:
        out = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        raise JobError("Optimizing took too long.") from None
    if out.returncode != 0:
        tail = (out.stderr or "").strip().splitlines()[-1:] or ["unknown error"]
        raise JobError(f"ffmpeg failed: {tail[0][:200]}")


def _callback(url: str, payload: Dict[str, Any]) -> None:
    body = json.dumps(payload, separators=(",", ":")).encode()
    signature = hmac.new(_secret().encode(), body, hashlib.sha256).hexdigest()
    headers = {"Content-Type": "application/json", "X-Nekter-Signature": signature}
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


@app.function(secrets=[secret], cpu=8.0, memory=8192, timeout=TIMEOUT_SEC, retries=0)
def optimize(job: Dict[str, str]) -> None:
    started = time.monotonic()
    result: Dict[str, Any] = {"jobId": job["jobId"], "mediaId": job["mediaId"], "ok": False}
    try:
        with tempfile.TemporaryDirectory() as tmp:
            src, dst = os.path.join(tmp, "source"), os.path.join(tmp, "out.mp4")
            src_size = _download(job["sourceUrl"], src)
            plan = plan_target(summarize_probe(_probe(src), src_size))
            # Leave time for the upload and the callback inside the function's own timeout.
            budget = lambda: max(60.0, TIMEOUT_SEC - (time.monotonic() - started) - 300)  # noqa: E731
            codec = "copy"
            if plan["action"] == "encode":
                _ffmpeg(encode_args(src, dst, plan), budget())
                codec = "hevc"
                if os.path.getsize(dst) >= src_size:  # bigger than what came in: keep the original stream
                    plan = {**plan, "action": "copy", "videoTag": None}
                    codec = "copy"
            if codec == "copy":
                info = summarize_probe(_probe(src), src_size)
                plan["videoTag"] = "hvc1" if info["videoCodec"] == "hevc" else None
                _ffmpeg(copy_args(src, dst, plan), budget())
            out = summarize_probe(_probe(dst))
            quarter = abs(out["rotation"]) % 180 == 90
            size = _upload(job["outputUrl"], dst)
            result.update(
                ok=True,
                sizeBytes=size,
                width=out["height"] if quarter else out["width"],
                height=out["width"] if quarter else out["height"],
                durationSec=out["durationSec"],
                codec=codec,
            )
    except JobError as err:
        result["error"] = str(err)
    except Exception as err:  # never send a raw message: it could hold a URL
        result["error"] = f"Unexpected error ({type(err).__name__})."
    print(json.dumps({k: v for k, v in result.items() if k != "mediaId"}))
    _callback(job["callbackUrl"], result)
