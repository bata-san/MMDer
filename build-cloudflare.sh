#!/usr/bin/env bash
set -euo pipefail

ARCHIVE_B64=".cloudflare-mmd-dist.tar.gz.b64"
ARCHIVE=".cloudflare-mmd-dist.tar.gz"
EXPECTED_SHA256="9729a92e188e1b20da7a9d201504317da7e1444f116a637d5fa43ba0d0ec493a"
MMD_WASM="node_modules/@yohawing/three-mmd-loader/dist/parser/wasm/generated/mmd_anim_wasm_bg.wasm"

rm -rf dist "$ARCHIVE_B64" "$ARCHIVE"
cat payload/part-* > "$ARCHIVE_B64"
base64 --decode "$ARCHIVE_B64" > "$ARCHIVE"
printf '%s  %s\n' "$EXPECTED_SHA256" "$ARCHIVE" | sha256sum --check --strict

tar -xzf "$ARCHIVE" dist
mkdir -p dist/src

cp runtime-patch/index.html dist/index.html
cp runtime-patch/style.css dist/src/style.css

test -f "$MMD_WASM"
cp "$MMD_WASM" dist/src/mmd_anim_wasm_bg.wasm

# MMD toon materials are designed around restrained lighting. The previous
# additive HemisphereLight 1.7 + DirectionalLight 2.4 clipped model colors to
# white and crushed shaded regions to black. Keep the runtime source readable,
# but enforce the calibrated values here so every Cloudflare build is correct.
python3 - <<'PY'
from pathlib import Path

path = Path('runtime-patch/three-main.js')
source = path.read_text(encoding='utf-8')
old = """  const hemi = new THREE.HemisphereLight(0xffffff, 0x687184, 1.7);
  scene.add(hemi);

  const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
  keyLight.position.set(8, 18, 10);"""
new = """  // Restrained MMD lighting preserves diffuse and toon-ramp colors.
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.15);
  scene.add(ambientLight);

  const keyLight = new THREE.DirectionalLight(0xffffff, 1.0);
  keyLight.position.set(3, 4, 5);"""

if old in source:
    source = source.replace(old, new, 1)
elif 'new THREE.AmbientLight(0xffffff, 0.15)' not in source:
    raise SystemExit('Unable to locate the MMD lighting block')

path.write_text(source, encoding='utf-8')
PY

grep -q 'new THREE.AmbientLight(0xffffff, 0.15)' runtime-patch/three-main.js
grep -q 'new THREE.DirectionalLight(0xffffff, 1.0)' runtime-patch/three-main.js
! grep -q 'new THREE.HemisphereLight(0xffffff, 0x687184, 1.7)' runtime-patch/three-main.js
! grep -q 'new THREE.DirectionalLight(0xffffff, 2.4)' runtime-patch/three-main.js

./node_modules/.bin/esbuild runtime-patch/three-main.js \
  --bundle \
  --format=esm \
  --platform=browser \
  --target=es2022 \
  --external:node:fs/promises \
  --external:node:url \
  --outfile=dist/src/main.js

cat > dist/favicon.svg <<'SVG'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="12" fill="#2563eb"/>
  <path d="M14 47V17h9l9 17 9-17h9v30h-8V30L35 43h-6l-7-13v17z" fill="#ffffff"/>
</svg>
SVG

cat > dist/_headers <<'HEADERS'
/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
  Cross-Origin-Resource-Policy: same-origin
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Permissions-Policy: camera=(), microphone=(), geolocation=()

/src/mmd_anim_wasm_bg.wasm
  Content-Type: application/wasm
  Cache-Control: public, max-age=86400, immutable
HEADERS

node --check dist/src/main.js
test -f dist/index.html
test -f dist/src/main.js
test -f dist/src/style.css
test -f dist/src/mmd_anim_wasm_bg.wasm
grep -q 'Three.js renderer' dist/index.html
grep -q 'VMDカメラ' dist/index.html
! grep -q 'MMD deform compute' dist/src/main.js

rm -f "$ARCHIVE_B64" "$ARCHIVE"
echo 'Cloudflare Three.js MMD build prepared in dist/'