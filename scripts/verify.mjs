import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const text = (path) => readFile(join(root, path), 'utf8');
const exists = (path) => stat(join(root, path)).then(() => true, () => false);

const packageJson = JSON.parse(await text('package.json'));
assert.equal(packageJson.version, '6.0.0');
assert(!packageJson.scripts.build.includes('prepare:runtime'));

const client = await text('src/client.ts');
assert(client.includes("await import('../runtime/app.js')"));
const runtime = await text('runtime/app.js');
assert(runtime.includes("import '../src/app.ts'"));

const worker = await text('worker/index.ts');
assert(worker.includes('env.ASSETS.fetch(request)'));
const wrangler = JSON.parse(await text('wrangler.jsonc'));
assert.equal(wrangler.assets.directory, './build/client');

const builtHtml = await text('build/client/index.html');
assert(!builtHtml.includes('app-stable.js'));
const assets = await readdir(join(root, 'build/client/assets'));
assert(assets.some((name) => name.endsWith('.js')), 'built JavaScript asset missing');

const encodedVmd = (await text('assets/default-idle.vmd')).trim();
assert(Buffer.from(encodedVmd, 'base64').byteLength > 1024);
assert(!(await exists('dist/app-stable.js')));

console.log('[verify] direct TypeScript runtime and Cloudflare asset bundle: OK');
