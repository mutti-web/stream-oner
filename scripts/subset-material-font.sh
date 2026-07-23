#!/usr/bin/env bash
# Material Symbols Outlined 互換の md-icon 用フォントを、利用アイコンだけにサブセット化する。
#
# 変数フォント (MaterialSymbolsOutlined[FILL,GRAD,opsz,wght].woff2) は
# pyftsubset + --layout-features='*' でほぼ全グリフが残り (~3.4MB) ため、
# リガチャサブセットが安定する静的 Material Icons Outlined をソースに使う。
# 出力の name テーブルは theme.css の @font-face 名に合わせてリネームする。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FONT_DIR="$ROOT/assets/fonts"
OUT="$FONT_DIR/MaterialSymbolsOutlined.woff2"
ICONS="$ROOT/scripts/material-icons.txt"
SOURCE_URL="https://raw.githubusercontent.com/google/material-design-icons/master/font/MaterialIconsOutlined-Regular.otf"

if [[ ! -f "$ICONS" ]]; then
  echo "missing: $ICONS" >&2
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

SOURCE="$TMP/MaterialIconsOutlined-Regular.otf"
echo "Downloading source font (Material Icons Outlined static)..."
curl -fsSL -o "$SOURCE" "$SOURCE_URL"

VENV="$TMP/venv"
python3 -m venv "$VENV"
"$VENV/bin/pip" install -q fonttools brotli zopfli

SUBSET_OTF="$TMP/MaterialIconsOutlined.subset.otf"
echo "Subsetting ($(grep -cve '^\s*$' "$ICONS") icons)..."
"$VENV/bin/pyftsubset" "$SOURCE" \
  --text-file="$ICONS" \
  --layout-features='*' \
  --output-file="$SUBSET_OTF"

echo "Converting to WOFF2 and renaming family..."
"$VENV/bin/python3" - <<PY
from fontTools.ttLib import TTFont

icons_path = "$ICONS"
subset_otf = "$SUBSET_OTF"
out_path = "$OUT"
family = "Material Symbols Outlined"

font = TTFont(subset_otf)
for rec in font["name"].names:
    if rec.nameID in (1, 4, 6):
        rec.string = family

font.flavor = "woff2"
font.save(out_path)

icons = [line.strip() for line in open(icons_path, encoding="utf-8") if line.strip()]
order = set(font.getGlyphOrder())
missing = [name for name in icons if name not in order]
if missing:
    raise SystemExit(f"missing icon glyphs after subset: {missing}")
print(f"icons: {len(icons)}, glyphs: {len(order)}")
PY

ls -lh "$OUT"
echo "Done: $OUT"
