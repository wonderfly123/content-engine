"""
Epidemic Sound for the editor worker, without Modal or the Agent SDK, so it runs (and is tested) anywhere.

The brand's own Epidemic Sound account (its MCP Server API key, sent with the job) lets the editor search the
catalogue and bring a track into the job's music/ folder. The worker talks to Epidemic Sound's MCP server
itself (JSON-RPC over Streamable HTTP) and gives the agent two small tools of its own (app.py), so the key
never enters the agent's process, its environment or its files.

- `EpidemicClient`: connect, call a tool, search recordings, get a signed download link.
- `MusicFinder`: one job's searches and downloads, with limits; `downloaded` maps each music/ file it saved
  to the recording it came from (contract.validate_manifest accepts those files as a cut's music).

Messages of `EpidemicError` are safe to show the agent: no key, no links.
"""
from __future__ import annotations

import json
import os
import re
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable, Dict, List, Optional

MCP_URL = "https://www.epidemicsound.com/a/mcp-service/mcp"
PROTOCOL = "2025-03-26"
ASSET_HOST_SUFFIX = ".epidemicsound.com"
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)
CHUNK = 1024 * 1024

MAX_SEARCHES = 12
MAX_DOWNLOADS = 4
MAX_RESULTS = 10
MAX_TRACK_BYTES = 60 * 1024**2
# The tools the agent sees (server "epidemic" in app.py).
SEARCH_TOOL = "mcp__epidemic__search_music"
DOWNLOAD_TOOL = "mcp__epidemic__download_track"
TOOL_NAMES = (SEARCH_TOOL, DOWNLOAD_TOOL)


class EpidemicError(Exception):
    """A failure whose message is safe to show the agent."""


def _first_data_event(raw: str) -> Optional[Dict[str, Any]]:
    """The JSON-RPC message in a response body: plain JSON, or the last `data:` line of an event stream."""
    raw = raw.strip()
    if raw.startswith("{"):
        return json.loads(raw)
    lines = [line[5:].strip() for line in raw.splitlines() if line.startswith("data:") and line[5:].strip().startswith("{")]
    return json.loads(lines[-1]) if lines else None


Opener = Callable[[urllib.request.Request, float], Any]


def _open(req: urllib.request.Request, timeout: float) -> Any:
    return urllib.request.urlopen(req, timeout=timeout)


class EpidemicClient:
    """A minimal MCP client for Epidemic Sound's server. Not thread-safe; one per job."""

    def __init__(self, api_key: str, url: str = MCP_URL, opener: Opener = _open) -> None:
        self._key = api_key
        self._url = url
        self._open = opener
        self._session: Optional[str] = None
        self._id = 0

    def _post(self, body: Dict[str, Any], timeout: float = 60) -> Optional[Dict[str, Any]]:
        headers = {"Authorization": f"Bearer {self._key}", "Content-Type": "application/json",
                   "Accept": "application/json, text/event-stream"}
        if self._session:
            headers["Mcp-Session-Id"] = self._session
        req = urllib.request.Request(self._url, json.dumps(body).encode(), headers, method="POST")
        try:
            with self._open(req, timeout) as res:
                self._session = res.headers.get("Mcp-Session-Id") or self._session
                raw = res.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as err:
            if err.code in (401, 403):
                raise EpidemicError("Epidemic Sound rejected the account's key.") from None
            raise EpidemicError(f"Epidemic Sound answered HTTP {err.code}.") from None
        except (urllib.error.URLError, OSError, ValueError) as err:
            raise EpidemicError(f"Epidemic Sound could not be reached ({type(err).__name__}).") from None
        try:
            return _first_data_event(raw)
        except ValueError:
            raise EpidemicError("Epidemic Sound sent an answer that could not be read.") from None

    def _rpc(self, method: str, params: Optional[Dict[str, Any]] = None, notify: bool = False) -> Optional[Dict[str, Any]]:
        body: Dict[str, Any] = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            body["params"] = params
        if not notify:
            self._id += 1
            body["id"] = self._id
        return self._post(body)

    def connect(self) -> None:
        self._session = None
        self._rpc("initialize", {"protocolVersion": PROTOCOL, "capabilities": {}, "clientInfo": {"name": "nekter-editor", "version": "1"}})
        self._rpc("notifications/initialized", notify=True)

    def call(self, tool: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Calls one of the server's tools and returns the `data` object of its answer."""
        if not self._session:
            self.connect()
        params = {"name": tool, "arguments": arguments}
        try:
            msg = self._rpc("tools/call", params)
        except EpidemicError as err:
            if "rejected" in str(err):
                raise
            self.connect()  # the session may have ended: once more on a new one
            msg = self._rpc("tools/call", params)
        if not isinstance(msg, dict):
            raise EpidemicError("Epidemic Sound sent no answer.")
        if isinstance(msg.get("error"), dict):
            raise EpidemicError(_clean(msg["error"].get("message")) or "Epidemic Sound refused the request.")
        result = msg.get("result") if isinstance(msg.get("result"), dict) else {}
        text = next((c.get("text") for c in result.get("content") or [] if isinstance(c, dict) and c.get("type") == "text"), None)
        try:
            payload = json.loads(text) if isinstance(text, str) else None
        except ValueError:
            payload = None
        errors = payload.get("errors") if isinstance(payload, dict) else None
        if result.get("isError") or errors or not isinstance(payload, dict) or not isinstance(payload.get("data"), dict):
            first = errors[0] if isinstance(errors, list) and errors and isinstance(errors[0], dict) else {}
            code = (first.get("extensions") or {}).get("code") if isinstance(first.get("extensions"), dict) else None
            detail = _clean(first.get("message")) or (_clean(text) if result.get("isError") else "")
            raise EpidemicError(f"Epidemic Sound: {detail or 'the request failed'}{f' ({code})' if code else ''}")
        return payload["data"]

    def search(self, term: str, bpm_min: Optional[int] = None, bpm_max: Optional[int] = None, vocals: Optional[bool] = None,
               min_seconds: Optional[int] = None, count: int = 8) -> List[Dict[str, Any]]:
        """Tracks for a plain-words search (mood, genre, feel), most relevant first."""
        flt: Dict[str, Any] = {}
        if bpm_min is not None or bpm_max is not None:
            flt["bpm"] = {k: v for k, v in (("min", bpm_min), ("max", bpm_max)) if v is not None}
        if vocals is not None:
            flt["vocals"] = vocals
        if min_seconds is not None:
            flt["duration"] = {"min": int(min_seconds) * 1000}
        args: Dict[str, Any] = {"query": {"term": term}, "first": max(1, min(MAX_RESULTS, count))}
        if flt:
            args["filter"] = flt
        data = self.call("SearchRecordings", args)
        nodes = (data.get("recordings") or {}).get("nodes") if isinstance(data.get("recordings"), dict) else None
        return [t for t in (compact(n.get("recording")) for n in nodes or [] if isinstance(n, dict)) if t]

    def download_url(self, recording_id: str) -> str:
        """A signed link to the full track as an mp3, on Epidemic Sound's own hosts."""
        data = self.call("DownloadRecording", {"id": recording_id, "options": {"fileType": "MP3", "stemType": "FULL"}})
        url = (data.get("recordingDownload") or {}).get("assetUrl") if isinstance(data.get("recordingDownload"), dict) else None
        host = urllib.parse.urlparse(url).hostname if isinstance(url, str) else None
        if not (isinstance(url, str) and url.startswith("https://") and host and ("." + host).endswith(ASSET_HOST_SUFFIX)):
            raise EpidemicError("Epidemic Sound gave no download for that track.")
        return url

    def fetch(self, url: str, dest: str, max_bytes: int = MAX_TRACK_BYTES) -> int:
        """Streams a download link to `dest`; returns its size. Nothing is left behind on a failure."""
        size = 0
        try:
            with self._open(urllib.request.Request(url, method="GET"), 120) as res, open(dest, "wb") as f:
                while True:
                    chunk = res.read(CHUNK)
                    if not chunk:
                        break
                    size += len(chunk)
                    if size > max_bytes:
                        raise EpidemicError("That track's file is too large to use.")
                    f.write(chunk)
        except EpidemicError:
            _remove(dest)
            raise
        except (urllib.error.URLError, OSError, ValueError) as err:
            _remove(dest)
            raise EpidemicError(f"The track could not be downloaded ({type(err).__name__}).") from None
        if size == 0:
            _remove(dest)
            raise EpidemicError("The track's file came back empty.")
        return size


def _remove(path: str) -> None:
    try:
        os.remove(path)
    except OSError:
        pass


def _clean(text: Any, max_len: int = 200) -> str:
    """One short line of someone else's message, with any link taken out."""
    if not isinstance(text, str):
        return ""
    return re.sub(r"\s+", " ", re.sub(r"https?://\S+", "[link]", text)).strip()[:max_len]


def compact(rec: Any) -> Optional[Dict[str, Any]]:
    """What the editor needs to choose a track: id, title, artist, tempo, length and a few tags."""
    if not isinstance(rec, dict) or not isinstance(rec.get("id"), str) or not UUID_RE.match(rec["id"]) or not isinstance(rec.get("title"), str):
        return None
    ms = (rec.get("audioFile") or {}).get("durationInMilliseconds") if isinstance(rec.get("audioFile"), dict) else None
    seconds = round(ms / 1000, 1) if isinstance(ms, (int, float)) and not isinstance(ms, bool) and ms > 0 else None
    artist = next((c["artist"].get("name") for c in rec.get("credits") or []
                   if isinstance(c, dict) and c.get("role") == "MAIN_ARTIST" and isinstance(c.get("artist"), dict)), None)
    tags = [t.get("displayName") for t in rec.get("tags") or [] if isinstance(t, dict) and isinstance(t.get("displayName"), str)]
    bpm = rec.get("bpm")
    return {"id": rec["id"].lower(), "title": _clean(rec["title"]) or "Untitled", "artist": _clean(artist, 100) or None,
            "bpm": bpm if isinstance(bpm, (int, float)) and not isinstance(bpm, bool) and 0 < bpm <= 400 else None,
            "seconds": seconds, "tags": tags[:8]}


def _int(v: Any, lo: int, hi: int) -> Optional[int]:
    return int(v) if isinstance(v, (int, float)) and not isinstance(v, bool) and lo <= v <= hi else None


class MusicFinder:
    """One job's use of Epidemic Sound. `search` and `download` take the agent's tool input and return the text
    it reads; they raise EpidemicError with a message it can act on."""

    def __init__(self, client: EpidemicClient, music_dir: str, max_searches: int = MAX_SEARCHES, max_downloads: int = MAX_DOWNLOADS) -> None:
        self.client = client
        self.music_dir = music_dir
        self.max_searches = max_searches
        self.max_downloads = max_downloads
        self.searches = 0
        self.seen: Dict[str, Dict[str, Any]] = {}        # recording id -> its search result
        self.downloaded: Dict[str, Dict[str, Any]] = {}  # music/ filename -> {recordingId, title, seconds, bpm}

    def search(self, args: Dict[str, Any]) -> str:
        term = args.get("term") if isinstance(args, dict) else None
        if not isinstance(term, str) or not term.strip() or len(term) > 200:
            raise EpidemicError("Give a `term`: a few plain words for the mood, genre or feel.")
        if self.searches >= self.max_searches:
            raise EpidemicError(f"This job has used its {self.max_searches} searches. Choose from the results you have, or from music/.")
        self.searches += 1
        vocals = args.get("vocals") if isinstance(args.get("vocals"), bool) else None
        found = self.client.search(term.strip(), _int(args.get("bpmMin"), 1, 400), _int(args.get("bpmMax"), 1, 400), vocals,
                                   _int(args.get("minSeconds"), 1, 3600), _int(args.get("count"), 1, 10_000) or 8)  # the client caps it at MAX_RESULTS
        usable = [t for t in found if t["seconds"]]
        for t in usable:
            self.seen[t["id"]] = t
        return json.dumps({"tracks": usable, "searchesLeft": self.max_searches - self.searches,
                           "downloadsLeft": self.max_downloads - len(self.downloaded)})

    def download(self, args: Dict[str, Any]) -> str:
        rid = args.get("id") if isinstance(args, dict) else None
        rid = rid.lower() if isinstance(rid, str) else None
        track = self.seen.get(rid) if rid else None
        if track is None:
            raise EpidemicError("Give the `id` of a track from one of this job's search results.")
        for name, meta in self.downloaded.items():
            if meta["recordingId"] == rid:
                return json.dumps({"file": f"music/{name}", "title": meta["title"], "bpm": meta["bpm"], "seconds": meta["seconds"]})
        if len(self.downloaded) >= self.max_downloads:
            raise EpidemicError(f"This job has used its {self.max_downloads} downloads. Use a track already in music/.")
        name = track_filename(track["title"], rid)
        self.client.fetch(self.client.download_url(rid), os.path.join(self.music_dir, name))
        self.downloaded[name] = {"recordingId": rid, "title": track["title"], "seconds": track["seconds"], "bpm": track["bpm"]}
        return json.dumps({"file": f"music/{name}", "title": track["title"], "bpm": track["bpm"], "seconds": track["seconds"],
                           "downloadsLeft": self.max_downloads - len(self.downloaded)})


def track_filename(title: str, recording_id: str) -> str:
    """es-<safe title>-<first 8 of the id>.mp3: cannot collide with the library's NN-<title> names."""
    stem = unicodedata.normalize("NFKD", title).encode("ascii", "ignore").decode()
    stem = re.sub(r"[^A-Za-z0-9]+", "-", stem).strip("-").lower()[:40] or "track"
    return f"es-{stem}-{recording_id[:8].lower()}.mp3"
