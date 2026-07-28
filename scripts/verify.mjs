import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const text = (path) => readFile(join(root, path), 'utf8');
const exists = (path) => stat(join(root, path)).then(() => true, () => false);

function stage(name) {
  console.log(`\n[verify] ${name}`);
}

stage('1/5 prepared runtime is direct and complete');
const runtimeDir = join(root, 'runtime');
const runtimeFiles = (await readdir(runtimeDir)).filter((name) => name.endsWith('.js'));
assert(runtimeFiles.length >= 16, 'prepared runtime has too few modules');
const forbidden = [
  'loadVerifiedApplication',
  'Verified runtime',
  'app-stable.js',
  'assets/verified-patch',
  'assets/life-runtime',
  'performance-patch',
  ' SAFE',
];
for (const name of runtimeFiles) {
  const source = await readFile(join(runtimeDir, name), 'utf8');
  for (const token of forbidden) assert(!source.includes(token), `${name} contains obsolete bootstrap token ${token}`);
  const importPattern = /(?:from\s+|import\s*\()(['"])(\.\.?\/[^'"]+)\1/g;
  for (const match of source.matchAll(importPattern)) {
    const target = resolve(dirname(join(runtimeDir, name)), match[2]);
    await stat(target).catch(() => { throw new Error(`${name} imports missing ${match[2]}`); });
  }
}
assert(await exists('runtime/model-worker.js'), 'module worker is missing');
assert(await exists('runtime/manifest.json'), 'runtime manifest is missing');
console.log(`  ${runtimeFiles.length} direct modules, no runtime archive fetch: OK`);

stage('2/5 motion and renderer safety');
const { blinkEnvelope, minimumJerk } = await import(`${pathToFileURL(join(runtimeDir, 'life-math.js')).href}?verify=${Date.now()}`);
for (const kind of ['soft', 'full', 'double']) {
  assert.equal(blinkEnvelope(kind, 0), 0, `${kind} blink must begin open`);
  assert.equal(blinkEnvelope(kind, 1), 0, `${kind} blink must end open`);
  for (let step = 0; step <= 100; step += 1) {
    const value = blinkEnvelope(kind, step / 100);
    assert(Number.isFinite(value) && value >= 0 && value <= 1, `${kind} envelope out of range`);
  }
}
assert.equal(minimumJerk(0), 0);
assert.equal(minimumJerk(1), 1);
const materials = await text('src/materials.ts');
assert(!materials.includes('lights_fragment_end'), 'MMD shader injection must remain disabled');
assert(!materials.includes('gradientMap.needsUpdate'), 'placeholder textures must not upload before image data exists');
assert(materials.includes('textureHasData(material.gradientMap)'), 'gradient textures must be guarded');
const life = await text('runtime/life.js');
assert(life.includes('morphTargetInfluences'), 'runtime blink must use actual MMD morphs');
console.log('  easing, morph blink, and texture guards: OK');

stage('3/5 TypeScript and Cloudflare contract');
const packageJson = JSON.parse(await text('package.json'));
assert.equal(packageJson.version, '5.1.0');
assert(packageJson.scripts.deploy.includes('wrangler deploy'));
assert(packageJson.scripts['prepare:runtime'].includes('prepare-runtime.mjs'));
const client = await text('src/client.ts');
assert(client.includes("const BUILD_VERSION = 'v5.1.0'"));
assert(client.includes("await import('../runtime/app.js')"));
assert(!client.includes('SAFE'));
const worker = await text('worker/index.ts');
assert(worker.includes('env.ASSETS.fetch(request)'));
assert(worker.includes("url.pathname === '/api/health'"));
assert(!worker.includes('SAFE'));
const wrangler = JSON.parse(await text('wrangler.jsonc'));
assert.equal(wrangler.main, 'worker/index.ts');
assert.equal(wrangler.assets.directory, './build/client');
assert.equal(wrangler.assets.binding, 'ASSETS');
assert.equal(wrangler.assets.run_worker_first, true);
console.log('  TypeScript Worker and Static Assets binding: OK');

stage('4/5 HTML and built bundle contract');
const viteConfig = await text('vite.config.ts');
assert(viteConfig.includes('transformIndexHtml'));
assert(viteConfig.includes('/src/client.ts'));
assert(viteConfig.includes("const BUILD_VERSION = 'v5.1.0'"));
const builtHtml = await text('build/client/index.html');
assert(!builtHtml.includes('/src/client.ts'), 'Vite must rewrite the TypeScript entry');
assert(!builtHtml.includes('app-stable.js'));
const builtAssetDir = join(root, 'build/client/assets');
const builtAssets = await readdir(builtAssetDir);
assert(builtAssets.some((name) => name.endsWith('.js')), 'built JavaScript asset missing');
for (const name of builtAssets.filter((item) => item.endsWith('.js'))) {
  const source = await readFile(join(builtAssetDir, name), 'utf8');
  for (const token of forbidden) assert(!source.includes(token), `built ${name} contains obsolete bootstrap token ${token}`);
}
console.log(`  Vite emitted ${builtAssets.length} hashed assets without patch bootstrap: OK`);

stage('5/5 model assets and deployment workflow');
const encodedVmd = (await text('assets/default-idle.vmd')).trim();
const vmd = Buffer.from(encodedVmd, 'base64');
assert(vmd.subarray(0, 30).toString('ascii').startsWith('Vocaloid Motion Data 0002'), 'default VMD header is invalid');
assert(vmd.byteLength > 1024, 'default VMD is unexpectedly small');
const workflow = await text('.github/workflows/deploy-cloudflare.yml');
assert(workflow.includes('npm run check'));
assert(workflow.includes('cloudflare/wrangler-action@v3'));
assert(workflow.includes('CLOUDFLARE_API_TOKEN'));
assert(!(await exists('dist/app-stable.js')), 'obsolete SAFE bootstrap must be deleted');
console.log('  VMD, deployment workflow, and obsolete bootstrap removal: OK');

console.log('\n[verify] all stages passed');
