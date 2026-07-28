import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = join(root, 'runtime');
const buildVersion = 'v5.1.0';

function safeArchivePath(path) {
  const normalized = path.replaceAll('\\', '/').replace(/^\.\//, '');
  assert(normalized && !normalized.startsWith('/') && !normalized.includes('../'), `Unsafe archive path: ${path}`);
  return normalized;
}

function tarString(buffer, start, length) {
  return buffer.subarray(start, start + length).toString('utf8').replace(/\0.*$/s, '').trim();
}

function parseTar(buffer) {
  const files = new Map();
  let offset = 0;
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every((value) => value === 0)) break;

    const name = tarString(header, 0, 100);
    const prefix = tarString(header, 345, 155);
    const path = safeArchivePath(prefix ? `${prefix}/${name}` : name);
    const sizeText = tarString(header, 124, 12) || '0';
    const size = Number.parseInt(sizeText, 8);
    assert(Number.isFinite(size) && size >= 0, `Invalid tar size for ${path}`);
    const type = String.fromCharCode(header[156] || 48);
    const bodyStart = offset + 512;
    const bodyEnd = bodyStart + size;
    assert(bodyEnd <= buffer.length, `Truncated tar entry: ${path}`);

    if ((type === '0' || type === '\0') && path) files.set(path, buffer.subarray(bodyStart, bodyEnd));
    offset = bodyStart + Math.ceil(size / 512) * 512;
  }
  return files;
}

function decodeArchive(encoded, label) {
  const compact = encoded.replace(/\s+/g, '');
  assert(compact.length > 0, `${label} is empty`);
  const compressed = Buffer.from(compact, 'base64');
  let archive;
  try {
    archive = gunzipSync(compressed);
  } catch (error) {
    throw new Error(`${label} is not valid gzip`, { cause: error });
  }
  const files = parseTar(archive);
  assert(files.size > 0, `${label} contains no files`);
  return files;
}

async function readChunkArchive(directory, label) {
  const absolute = join(root, directory);
  const names = (await readdir(absolute))
    .filter((name) => /^chunk-\d+$/.test(name))
    .sort((left, right) => left.localeCompare(right, 'en', { numeric: true }));
  assert(names.length > 0, `${label} has no chunks`);
  names.forEach((name, index) => {
    assert.equal(name, `chunk-${String(index).padStart(2, '0')}`, `${label} chunk sequence is incomplete`);
  });
  const chunks = await Promise.all(names.map((name) => readFile(join(absolute, name), 'utf8')));
  return decodeArchive(chunks.join(''), label);
}

async function readSingleArchive(path, label) {
  return decodeArchive(await readFile(join(root, path), 'utf8'), label);
}

function overlay(target, source) {
  for (const [path, content] of source) target.set(path, content);
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

async function writeRuntime(files) {
  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });

  const manifest = {};
  const forbidden = [
    'loadVerifiedApplication',
    'Verified runtime',
    'app-stable.js',
    'assets/verified-patch',
    'assets/life-runtime',
    'performance-patch',
    ' SAFE',
  ];

  for (const [archivePath, content] of files) {
    if (!archivePath.startsWith('dist/') || !archivePath.endsWith('.js')) continue;
    const outputPath = safeArchivePath(archivePath.slice('dist/'.length));
    let source = content.toString('utf8');
    if (outputPath === 'state.js') {
      source = source.replace(/BUILD_VERSION\s*=\s*['"]v[^'"]+['"]/, `BUILD_VERSION = '${buildVersion}'`);
    }
    for (const token of forbidden) {
      assert(!source.includes(token), `${outputPath} still contains runtime patch bootstrap token: ${token}`);
    }

    const destination = resolve(outputDirectory, outputPath);
    assert(destination === outputDirectory || destination.startsWith(`${outputDirectory}${sep}`), `Output escaped runtime directory: ${outputPath}`);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, source, 'utf8');
    manifest[outputPath] = { bytes: Buffer.byteLength(source), sha256: sha256(source) };
  }

  const required = [
    'app.js',
    'dom.js',
    'interaction.js',
    'life-math.js',
    'life.js',
    'materials.js',
    'model-worker.js',
    'models.js',
    'motion.js',
    'physics.js',
    'scene.js',
    'state.js',
    'storage.js',
    'ui.js',
    'views.js',
    'xr.js',
  ];
  for (const name of required) assert(name in manifest, `Prepared runtime is missing ${name}`);

  const appSource = await readFile(join(outputDirectory, 'app.js'), 'utf8');
  assert(!/\bfetch\s*\([^)]*(?:verified-patch|life-runtime|performance-patch)/s.test(appSource), 'Runtime app must not fetch build archives');

  await writeFile(join(outputDirectory, 'manifest.json'), `${JSON.stringify({ version: buildVersion, files: manifest }, null, 2)}\n`, 'utf8');
  console.log(`[prepare:runtime] wrote ${Object.keys(manifest).length} direct ES modules to ${relative(root, outputDirectory)}`);
}

const runtimeFiles = new Map();
overlay(runtimeFiles, await readChunkArchive('assets/verified-patch', 'verified runtime archive'));
overlay(runtimeFiles, await readSingleArchive('assets/performance-patch', 'performance archive'));
overlay(runtimeFiles, await readChunkArchive('assets/life-runtime', 'life archive'));
await writeRuntime(runtimeFiles);
