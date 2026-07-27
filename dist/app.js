const PATCH_CHUNKS = 9;
const THREE_VERSION = '0.166.1';
const decoder = new TextDecoder();

function decodeBase64(value) {
  const binary = atob(value.replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function decompressGzip(bytes) {
  if (!('DecompressionStream' in window)) throw new Error('This browser does not support DecompressionStream.');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function tarText(bytes, start, length) {
  return decoder.decode(bytes.subarray(start, start + length)).replace(/\0.*$/s, '').trim();
}

function parseTar(bytes) {
  const files = new Map();
  let offset = 0;
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every((value) => value === 0)) break;
    const name = tarText(header, 0, 100);
    const prefix = tarText(header, 345, 155);
    const path = prefix ? `${prefix}/${name}` : name;
    const sizeText = tarText(header, 124, 12);
    const size = Number.parseInt(sizeText || '0', 8);
    const type = String.fromCharCode(header[156] || 48);
    const bodyStart = offset + 512;
    if ((type === '0' || type === '\0') && path) {
      files.set(path.replace(/^\.\//, ''), decoder.decode(bytes.subarray(bodyStart, bodyStart + size)));
    }
    offset = bodyStart + Math.ceil(size / 512) * 512;
  }
  return files;
}

function externalUrl(specifier) {
  if (specifier === 'three') return `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/build/three.module.js`;
  if (specifier.startsWith('three/addons/')) {
    return `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/examples/jsm/${specifier.slice('three/addons/'.length)}`;
  }
  return null;
}

function replaceSpecifier(source, specifier, replacement) {
  const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return source.replace(new RegExp(`(['"])${escaped}\\1`, 'g'), JSON.stringify(replacement));
}

async function loadVerifiedApplication() {
  const status = document.querySelector('#notice');
  if (status) status.textContent = 'VERIFYING RUNTIME…';

  const chunkUrls = Array.from({ length: PATCH_CHUNKS }, (_, index) =>
    new URL(`../assets/verified-patch/chunk-${String(index).padStart(2, '0')}`, import.meta.url),
  );
  const chunks = await Promise.all(chunkUrls.map(async (url) => {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Patch chunk unavailable: ${url.pathname}`);
    return response.text();
  }));
  const archive = await decompressGzip(decodeBase64(chunks.join('')));
  const files = parseTar(archive);
  const overlays = new Map();
  for (const [path, originalSource] of files) {
    if (!path.startsWith('dist/') || !path.endsWith('.js')) continue;
    const source = path === 'dist/state.js'
      ? originalSource.replace("BUILD_VERSION = 'v4.2.0'", "BUILD_VERSION = 'v4.3.0'")
      : originalSource;
    overlays.set(new URL(`../${path}`, import.meta.url).href, source);
  }

  const cache = new Map();
  async function buildModule(moduleUrl) {
    const normalizedUrl = new URL(moduleUrl).href;
    if (cache.has(normalizedUrl)) return cache.get(normalizedUrl);
    const promise = (async () => {
      let source = overlays.get(normalizedUrl);
      if (source === undefined) {
        const response = await fetch(normalizedUrl, { cache: 'no-store' });
        if (!response.ok) throw new Error(`Module unavailable: ${new URL(normalizedUrl).pathname}`);
        source = await response.text();
      }

      source = source.replace(
        /new URL\(\s*(['"])(\.[^'"]+)\1\s*,\s*import\.meta\.url\s*\)/g,
        (_match, _quote, relative) => `new URL(${JSON.stringify(new URL(relative, normalizedUrl).href)})`,
      );

      const externalSpecifiers = new Set();
      for (const match of source.matchAll(/\b(?:from|import)\s*['"]([^'"]+)['"]/g)) {
        if (!match[1].startsWith('.')) externalSpecifiers.add(match[1]);
      }
      for (const specifier of externalSpecifiers) {
        const replacement = externalUrl(specifier);
        if (replacement) source = replaceSpecifier(source, specifier, replacement);
      }

      const relativeSpecifiers = new Set();
      for (const match of source.matchAll(/\b(?:from|import)\s*['"](\.[^'"]+)['"]/g)) {
        relativeSpecifiers.add(match[1]);
      }
      for (const specifier of relativeSpecifiers) {
        const dependencyUrl = new URL(specifier, normalizedUrl).href;
        const blobUrl = await buildModule(dependencyUrl);
        source = replaceSpecifier(source, specifier, blobUrl);
      }

      return URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    })();
    cache.set(normalizedUrl, promise);
    return promise;
  }

  const verifiedApp = await buildModule(new URL('./app.js', import.meta.url).href);
  await import(verifiedApp);
}

loadVerifiedApplication().catch((error) => {
  console.error('Verified runtime failed to start.', error);
  const status = document.querySelector('#notice');
  if (status) status.textContent = 'RUNTIME LOAD ERROR';
  const toast = document.querySelector('#toast');
  if (toast) {
    toast.textContent = `起動に失敗しました: ${error instanceof Error ? error.message : String(error)}`;
    toast.classList.add('show');
  }
});
