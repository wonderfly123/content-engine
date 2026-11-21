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
