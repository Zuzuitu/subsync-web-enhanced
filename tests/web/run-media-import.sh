#!/usr/bin/env bash
set -euo pipefail
browser="${1:?Expected chromium or webkit}"
shift
case "$browser" in chromium|webkit) ;; *) exit 2 ;; esac

# Do not upgrade the existing pinned 1.55 ASR/compatibility test environment.
# This runner needs the upstream Linux WebKit fix that actually enables OPFS.
runner="tests/generated/media-import-runner"
export PLAYWRIGHT_BROWSERS_PATH="$PWD/tests/generated/media-import-browsers"
python3 -m venv "$runner"
"$runner/bin/python" -m pip install --disable-pip-version-check -r tests/web/media-import-requirements.txt
if [ "$browser" = webkit ]; then
  "$runner/bin/python" -m playwright install --with-deps webkit
elif ! command -v google-chrome >/dev/null && ! command -v chromium >/dev/null && ! command -v chromium-browser >/dev/null; then
  "$runner/bin/python" -m playwright install --with-deps chromium
fi
"$runner/bin/python" tests/web/run-media-import.py --browser "$browser" "$@"
