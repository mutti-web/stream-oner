#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT_NAME="$(basename "$ROOT_DIR")"
PARENT_DIR="$(dirname "$ROOT_DIR")"
VERSION="$(node -p "require('$ROOT_DIR/package.json').version")"
OUT_ZIP="$PARENT_DIR/${PROJECT_NAME}-v${VERSION}-src.zip"

echo "Creating source zip: $OUT_ZIP"
rm -f "$OUT_ZIP"

cd "$PARENT_DIR"
zip -r "$OUT_ZIP" "$PROJECT_NAME" \
  -x "$PROJECT_NAME/node_modules/*" \
  -x "$PROJECT_NAME/node_modules/**/*" \
  -x "$PROJECT_NAME/.git/*" \
  -x "$PROJECT_NAME/.git/**/*" \
  -x "$PROJECT_NAME/dist/*" \
  -x "$PROJECT_NAME/dist/**/*" \
  -x "$PROJECT_NAME/release/*" \
  -x "$PROJECT_NAME/release/**/*" \
  -x "$PROJECT_NAME/.ai_docs/*" \
  -x "$PROJECT_NAME/.ai_docs/**/*" \
  -x "$PROJECT_NAME/youtube-oauth.local.json" \
  -x "$PROJECT_NAME/*.zip" \
  -x "$PROJECT_NAME/.DS_Store" \
  -x "$PROJECT_NAME/**/.DS_Store"

echo "Done: $OUT_ZIP"
ls -lh "$OUT_ZIP"
