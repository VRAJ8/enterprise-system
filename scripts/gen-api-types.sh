#!/usr/bin/env bash
# Regenerate frontend/src/api/schema.d.ts from the FastAPI app (no running server needed).
#   scripts/gen-api-types.sh          # write the file
#   scripts/gen-api-types.sh --check  # fail if the committed file is out of date (CI)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PYTHON="${PYTHON:-python}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

(cd "$ROOT/backend" && ENV=test "$PYTHON" -c "import json; from app.main import app; print(json.dumps(app.openapi()))") > "$TMP/openapi.json"
(cd "$ROOT/frontend" && npx --no-install openapi-typescript "$TMP/openapi.json" -o "$TMP/schema.d.ts" >/dev/null)

if [[ "${1:-}" == "--check" ]]; then
  if ! diff -q "$TMP/schema.d.ts" "$ROOT/frontend/src/api/schema.d.ts" >/dev/null; then
    echo "frontend/src/api/schema.d.ts is out of date. Run scripts/gen-api-types.sh and commit the result." >&2
    diff -u "$ROOT/frontend/src/api/schema.d.ts" "$TMP/schema.d.ts" | head -40 >&2
    exit 1
  fi
  echo "API types are up to date."
else
  cp "$TMP/schema.d.ts" "$ROOT/frontend/src/api/schema.d.ts"
  echo "Wrote frontend/src/api/schema.d.ts"
fi
