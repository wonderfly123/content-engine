# Cloud video editor (Modal)

```bash
modal secret create nekter-editor MODAL_EDITOR_SECRET=<long random string>
cd workers/editor && modal deploy app.py     # prints the `submit` endpoint URL
python3 -I test_editor.py                    # local tests (contract, guards, real ffmpeg render)
```

In Vercel set `MODAL_EDITOR_URL` (the printed `submit` URL) and `MODAL_EDITOR_SECRET` (same value).
Job contract: `contract.py`; the agent's instructions: `skill/SKILL.md`. The Anthropic key comes per job from the workspace.
So does the workspace's Epidemic Sound key, when it has connected one (Settings > Integrations): the agent then gets
two tools served by the worker (`epidemic.py`; the skill's `epidemic-sound.md` says when to use them). Deploy the
worker before the app whenever a skill file is added: an older worker refuses a job that carries a file it doesn't know.

## Before a change here goes live

Upload, shrinking and editing only prove themselves on real footage: phone clips are 4K, HDR, and
hundreds of megabytes each, and limits that hold for a test clip have broken on them more than once.
So a change to any of the three is not merged, and no worker is deployed, until this passes:

```bash
scripts/pipeline-check.sh
```

It runs the web tests, this worker's tests (which build a synthetic 4K HDR clip), and
`check_footage.py` on the fixed set of real clips in
`/Volumes/Seagate/ai-video-editing/pipeline-check/footage` (pass another folder as the argument).
A run without the real clips counts as a failure, not a pass.

After it passes: deploy the worker (`modal deploy app.py`) before merging the app change when the
app starts sending the worker something new, and run one real edit end to end before calling it done.

## Working copies

Before the agent starts, every heavy clip (bigger than 1080x1920, HDR, or over 16 Mbit/s) gets a
540-pixel standard-range copy in `footage/` under the same name, and the original moves to
`originals/` (`prepare.py`). The agent scans, samples, listens and finds the action on the copies;
`render.sh` takes each shot from `originals/` when the clip has one. Times and crops chosen on a copy
apply to its original unchanged.

