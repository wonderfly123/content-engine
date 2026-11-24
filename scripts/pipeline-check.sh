#!/bin/bash
# The check every change to upload, shrinking or editing must pass before it goes live.
#   scripts/pipeline-check.sh [folder of real clips]
# 1. the web tests, 2. the editor worker's tests (including a synthetic 4K HDR clip),
# 3. the editor's prepare-and-render steps on real footage (workers/editor/check_footage.py).
# The real clips default to the fixed set on the Seagate drive; without them step 3 is reported as skipped,
# and a skipped step 3 is not a pass.
set -u
cd "$(dirname "$0")/.."
CLIPS="${1:-/Volumes/Seagate/ai-video-editing/pipeline-check/footage}"
PY="${PIPELINE_CHECK_PYTHON:-/usr/bin/python3}"
fail=0

echo "== 1/3 web tests"
npx tsc --noEmit || fail=1
npm test --silent || fail=1

echo "== 2/3 editor worker tests"
"$PY" workers/editor/test_editor.py || fail=1

echo "== 3/3 real footage: $CLIPS"
if [ -d "$CLIPS" ]; then
  "$PY" workers/editor/check_footage.py "$CLIPS" || fail=1
else
  echo "SKIPPED: no real clips at $CLIPS. This is not a pass."
  fail=1
fi

[ "$fail" -eq 0 ] && echo "PIPELINE CHECK PASSED" || echo "PIPELINE CHECK FAILED"
exit "$fail"
