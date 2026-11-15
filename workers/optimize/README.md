# Clip optimizer (Modal)

```bash
modal secret create nekter-optimize MODAL_OPTIMIZE_SECRET=<long random string>
cd workers/optimize && modal deploy app.py   # prints the `submit` endpoint URL
python3 test_target.py                        # local tests (rules table + real ffmpeg)
```

In Vercel set `MODAL_OPTIMIZE_URL` (the printed `submit` URL), `MODAL_OPTIMIZE_SECRET` (same value), and `APP_URL=https://app.nekter.io`.
