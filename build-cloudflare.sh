#!/usr/bin/env bash
set -euo pipefail

ARCHIVE_B64=".cloudflare-mmd-dist.tar.gz.b64"
ARCHIVE=".cloudflare-mmd-dist.tar.gz"
EXPECTED_SHA256="9729a92e188e1b20da7a9d201504317da7e1444f116a637d5fa43ba0d0ec493a"

rm -rf dist "$ARCHIVE_B64" "$ARCHIVE"
cat payload/part-* > "$ARCHIVE_B64"
base64 --decode "$ARCHIVE_B64" > "$ARCHIVE"
printf '%s  %s\n' "$EXPECTED_SHA256" "$ARCHIVE" | sha256sum --check --strict

tar -xzf "$ARCHIVE" dist

# Apply maintained runtime fixes after restoring the original bundle.
cp runtime-patch/shaders.js dist/src/shaders.js
cp runtime-patch/style.css dist/src/style.css

python3 - <<'PY'
from pathlib import Path

main = Path('dist/src/main.js')
source = main.read_text(encoding='utf-8')
needle = '    state.core.load(model, motion);'
guard = "    if (!state.core || !state.renderer) throw new Error('描画エンジンの初期化が完了していません。ページを再読み込みしてください。');\n" + needle
if needle in source and '描画エンジンの初期化が完了していません' not in source:
    source = source.replace(needle, guard, 1)
main.write_text(source, encoding='utf-8')

renderer = Path('dist/src/renderer.js')
renderer_source = renderer.read_text(encoding='utf-8')
renderer_source = renderer_source.replace(
    "clearValue: { r: 0.025, g: 0.03, b: 0.045, a: 1 }",
    "clearValue: { r: 0.94, g: 0.95, b: 0.97, a: 1 }",
)
renderer.write_text(renderer_source, encoding='utf-8')

index = Path('dist/index.html')
html = index.read_text(encoding='utf-8')
html = html.replace('<meta name="theme-color" content="#101521">', '<meta name="theme-color" content="#ffffff">')
if 'rel="icon"' not in html:
    html = html.replace('<head>', '<head>\n  <link rel="icon" href="./favicon.svg" type="image/svg+xml">', 1)
index.write_text(html, encoding='utf-8')

Path('dist/favicon.svg').write_text('''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="12" fill="#2563eb"/>
  <path d="M14 47V17h9l9 17 9-17h9v30h-8V30L35 43h-6l-7-13v17z" fill="#ffffff"/>
</svg>\n''', encoding='utf-8')

Path('dist/_headers').write_text('''/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
  Cross-Origin-Resource-Policy: same-origin
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Permissions-Policy: camera=(), microphone=(), geolocation=()

/public/mmd_core.wasm
  Cache-Control: public, max-age=3600, must-revalidate
''', encoding='utf-8')
PY

node --check dist/src/main.js
node --check dist/src/renderer.js
node --check dist/src/shaders.js
test -f dist/index.html
test -f dist/src/main.js
test -f dist/src/shaders.js
test -f dist/src/style.css
test -f dist/public/mmd_core.wasm
! grep -q 'meta: vec4u' dist/src/shaders.js
grep -q 'skinKind: vec4u' dist/src/shaders.js
! grep -q 'webgl-renderer.js' dist/src/main.js

rm -f "$ARCHIVE_B64" "$ARCHIVE"
echo 'Cloudflare build output prepared in dist/'
