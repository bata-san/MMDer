import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { blinkEnvelope, minimumJerk } from '../dist/life-math.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const text = (path) => readFile(join(root, path), 'utf8');

function stage(name) {
  console.log(`\n[verify] ${name}`);
}

stage('1/4 renderer and asset safety');
const materials = await text('src/materials.ts');
assert(!materials.includes('lights_fragment_end'), 'MMD shader injection must remain disabled');
assert(!materials.includes('mmdLabSpecular'), 'custom MMD fragment uniforms must remain disabled');
assert(!materials.includes('gradientMap.needsUpdate'), 'placeholder gradient textures must not be uploaded early');
assert(materials.includes('textureHasData(material.gradientMap)'), 'gradient map must be guarded by image availability');
console.log('  native MMD shader path and texture guards: OK');

stage('2/4 MMD morph blink lifecycle');
for (const kind of ['soft', 'full', 'double']) {
  assert.equal(blinkEnvelope(kind, 0), 0, `${kind} blink must begin open`);
  assert.equal(blinkEnvelope(kind, 1), 0, `${kind} blink must end open`);
  for (let step = 0; step <= 100; step += 1) {
    const value = blinkEnvelope(kind, step / 100);
    assert(Number.isFinite(value) && value >= 0 && value <= 1, `${kind} envelope out of range`);
  }
  const peak = Math.max(...Array.from({ length: 101 }, (_, i) => blinkEnvelope(kind, i / 100)));
  assert(peak > 0.85, `${kind} blink must close visibly`);
}
assert.equal(minimumJerk(0), 0);
assert.equal(minimumJerk(1), 1);
const base = 0.17;
let lastProcedural = 0;
let influence = base;
for (let step = 0; step <= 100; step += 1) {
  const observedBase = Math.max(0, Math.min(1, influence - lastProcedural));
  const contribution = (1 - observedBase) * blinkEnvelope('full', step / 100) * 0.94;
  influence = observedBase + contribution;
  lastProcedural = contribution;
}
influence = Math.max(0, Math.min(1, influence - lastProcedural));
assert(Math.abs(influence - base) < 1e-9, 'blink must restore the pre-blink morph value');
const lifeSource = await text('src/life.ts');
assert(lifeSource.includes('morphTargetInfluences'), 'blink must write actual MMD morph influences');
assert(lifeSource.includes('baseValue'), 'blink must preserve a non-accumulating morph baseline');
console.log('  blink envelope, morph use, and open-state restoration: OK');

stage('3/4 interactions, physics regions, and multi-model controls');
const physics = await text('src/physics.ts');
const types = await text('src/types.ts');
const interaction = await text('src/interaction.ts');
for (const region of ['hairFront', 'hairBack', 'hairSide', 'skirt', 'cloth', 'accessory', 'chest', 'torso', 'hips', 'arms', 'legs']) {
  assert(types.includes(`'${region}'`), `missing physics region ${region}`);
}
assert(physics.includes('pokePhysics') && physics.includes('beginPhysicsPull') && physics.includes('updatePhysicsPull'));
assert(interaction.includes("case 'poke'") && interaction.includes("case 'pull'") && interaction.includes("case 'move'"));
const views = await text('src/views.ts');
assert(views.includes('toggleModelSelection'), 'multi-model click selection must be toggle-aware');
console.log('  segmented dynamics, poke/pull/move, and multi-model selection: OK');

stage('4/4 build graph, DOM contract, and bundled VMD');
const distDir = join(root, 'dist');
const jsFiles = (await readdir(distDir)).filter((name) => name.endsWith('.js'));
for (const name of jsFiles) {
  const source = await readFile(join(distDir, name), 'utf8');
  const importPattern = /(?:from\s+|import\s*\()(['"])(\.\.?\/[^'"]+)\1/g;
  for (const match of source.matchAll(importPattern)) {
    const target = resolve(dirname(join(distDir, name)), match[2]);
    await stat(target).catch(() => { throw new Error(`${name} imports missing ${match[2]}`); });
  }
}
const html = await text('index.html');
const ids = new Set([...html.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]));
const selectorFiles = (await readdir(join(root, 'src'))).filter((name) => name.endsWith('.ts'));
for (const name of selectorFiles) {
  const source = await text(`src/${name}`);
  for (const match of source.matchAll(/['"]#([A-Za-z][\w-]*)['"]/g)) {
    assert(ids.has(match[1]), `${name} references missing DOM id #${match[1]}`);
  }
}
const encodedVmd = (await text('assets/default-idle.vmd')).trim();
const vmd = Buffer.from(encodedVmd, 'base64');
assert(vmd.subarray(0, 30).toString('ascii').startsWith('Vocaloid Motion Data 0002'), 'default VMD header is invalid');
assert(vmd.byteLength > 1024, 'default VMD is unexpectedly small');
const packageJson = JSON.parse(await text('package.json'));
const stateSource = await text('src/state.ts');
const version = stateSource.match(/BUILD_VERSION = 'v([^']+)'/)?.[1];
assert.equal(version, packageJson.version, 'package and UI build versions must match');
assert(html.includes(`mmd-lab-${packageJson.version.replaceAll('.', '-')}`), 'index cache-buster version must match package');
console.log(`  ${jsFiles.length} modules, DOM selectors, VMD header, and version contract: OK`);

console.log('\n[verify] all stages passed');
