const PATCH_CHUNKS = 9;
const THREE_VERSION = '0.166.1';
const PREFERENCE_KEY = 'mmd-lab-preferences-v2';

const EXCLUDED_CONTROL_IDS = new Set([
  'library-toggle', 'inspector-toggle', 'models-file', 'motions-file', 'folder', 'hdri',
  'timeline', 'rig-edit', 'show-hdri',
]);
const decoder = new TextDecoder();

function installShellUi() {
  if (!document.querySelector('#theme-performance-style')) {
    const link = document.createElement('link');
    link.id = 'theme-performance-style';
    link.rel = 'stylesheet';
    link.href = new URL('../theme-performance.css?v=mmd-lab-4-4-0', import.meta.url).href;
    document.head.append(link);
  }
  const status = document.querySelector('.status');
  if (status && !document.querySelector('#load-meter')) {
    const meter = document.createElement('span');
    meter.id = 'load-meter';
    meter.className = 'load-meter';
    meter.hidden = true;
    meter.innerHTML = '<i id="load-progress"></i><b id="load-label">準備中</b>';
    status.append(meter);
  }
  if (status && !document.querySelector('#theme-toggle')) {
    const button = document.createElement('button');
    button.id = 'theme-toggle';
    button.className = 'theme-toggle';
    button.type = 'button';
    button.dataset.themeToggle = '';
    button.setAttribute('aria-label', '白と黒のテーマを切り替える');
    button.innerHTML = '<span aria-hidden="true">◐</span><b>LIGHT</b>';
    status.append(button);
  }
  const mobileActions = document.querySelector('.mobile-dock-actions');
  if (mobileActions && !mobileActions.querySelector('[data-theme-toggle]')) {
    const button = document.createElement('button');
    button.className = 'theme-toggle';
    button.type = 'button';
    button.dataset.themeToggle = '';
    button.setAttribute('aria-label', '白と黒のテーマを切り替える');
    button.innerHTML = '<span aria-hidden="true">◐</span>';
    mobileActions.append(button);
  }
  const build = document.querySelector('#build-version');
  if (build) build.textContent = 'v4.4.0';
}

installShellUi();

function readPreferences() {
  try {
    const value = JSON.parse(localStorage.getItem(PREFERENCE_KEY) || '{}');
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

function applyTheme(theme, notify = true) {
  const next = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
    const label = button.querySelector('b');
    if (label) label.textContent = next === 'light' ? 'DARK' : 'LIGHT';
    button.setAttribute('aria-pressed', String(next === 'light'));
    button.title = next === 'light' ? '黒いテーマへ切り替える' : '白いテーマへ切り替える';
  });
  const color = document.querySelector('meta[name="theme-color"]');
  color?.setAttribute('content', next === 'light' ? '#eef1f5' : '#0b0e14');
  if (notify) window.dispatchEvent(new CustomEvent('mmdlab-theme-change', { detail: { theme: next } }));
  return next;
}

const initialPreferences = readPreferences();
applyTheme(initialPreferences.theme, false);

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

function controlPreferenceKey(element) {
  if (!(element instanceof HTMLInputElement || element instanceof HTMLSelectElement)) return null;
  if (element instanceof HTMLInputElement && (element.type === 'file' || element.type === 'button')) return null;
  if (element.id) return EXCLUDED_CONTROL_IDS.has(element.id) ? null : `id:${element.id}`;
  const card = element.closest('.region-card');
  const container = card?.parentElement;
  if (!card || !container?.id) return null;
  const cards = [...container.children].filter((child) => child.classList.contains('region-card'));
  const cardIndex = cards.indexOf(card);
  const inputs = [...card.querySelectorAll('input,select')];
  const inputIndex = inputs.indexOf(element);
  const token = element.dataset.key || (element.classList.contains('part-enabled') ? 'enabled' : `control-${inputIndex}`);
  return `dynamic:${container.id}:${cardIndex}:${token}`;
}

function collectPreferences() {
  const controls = {};
  document.querySelectorAll('input,select').forEach((element) => {
    const key = controlPreferenceKey(element);
    if (!key) return;
    controls[key] = element instanceof HTMLInputElement && element.type === 'checkbox'
      ? { kind: 'checked', value: element.checked }
      : { kind: 'value', value: element.value };
  });
  const details = {};
  document.querySelectorAll('details').forEach((element, index) => { details[String(index)] = element.open; });
  return {
    version: 2,
    theme: document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',
    controls,
    details,
    activeTab: document.querySelector('.tabs button.active')?.dataset.tab || 'motion',
  };
}

function savePreferences() {
  try { localStorage.setItem(PREFERENCE_KEY, JSON.stringify(collectPreferences())); } catch { /* private mode or quota */ }
}

function restorePreferences(preferences) {
  const controls = preferences.controls && typeof preferences.controls === 'object' ? preferences.controls : {};
  document.querySelectorAll('input,select').forEach((element) => {
    const key = controlPreferenceKey(element);
    const saved = key ? controls[key] : null;
    if (!saved) return;
    if (element instanceof HTMLInputElement && element.type === 'checkbox' && saved.kind === 'checked') {
      element.checked = Boolean(saved.value);
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    if (saved.kind === 'value') {
      element.value = String(saved.value);
      element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
    }
  });
  if (preferences.details && typeof preferences.details === 'object') {
    document.querySelectorAll('details').forEach((element, index) => {
      if (String(index) in preferences.details) element.open = Boolean(preferences.details[String(index)]);
    });
  }
  const tab = document.querySelector(`.tabs button[data-tab="${CSS.escape(preferences.activeTab || 'motion')}"]`);
  if (tab instanceof HTMLButtonElement) tab.click();
  applyTheme(preferences.theme, true);
}

function installPreferencePersistence() {
  let timer = 0;
  const scheduleSave = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(savePreferences, 140);
  };
  document.addEventListener('input', scheduleSave, true);
  document.addEventListener('change', scheduleSave, true);
  document.querySelectorAll('details').forEach((element) => element.addEventListener('toggle', scheduleSave));
  document.querySelectorAll('.tabs button').forEach((element) => element.addEventListener('click', scheduleSave));
  document.querySelectorAll('[data-theme-toggle]').forEach((element) => {
    element.addEventListener('click', () => {
      applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light', true);
      savePreferences();
    });
  });
  window.addEventListener('beforeunload', savePreferences);
}

async function loadVerifiedApplication() {
  const status = document.querySelector('#notice');
  if (status) status.textContent = 'VERIFYING RUNTIME…';

  const chunkUrls = Array.from({ length: PATCH_CHUNKS }, (_, index) =>
    new URL(`../assets/verified-patch/chunk-${String(index).padStart(2, '0')}`, import.meta.url),
  );
  const chunks = await Promise.all(chunkUrls.map(async (url) => {
    const response = await fetch(url, { cache: 'force-cache' });
    if (!response.ok) throw new Error(`Patch chunk unavailable: ${url.pathname}`);
    return response.text();
  }));
  const archive = await decompressGzip(decodeBase64(chunks.join('')));
  const files = parseTar(archive);
  const performanceResponse = await fetch(new URL('../assets/performance-patch?v=mmd-lab-4-4-0', import.meta.url), { cache: 'no-store' });
  if (!performanceResponse.ok) throw new Error('Performance runtime patch is unavailable.');
  const performanceArchive = await decompressGzip(decodeBase64(await performanceResponse.text()));
  for (const [path, source] of parseTar(performanceArchive)) files.set(path, source);
  const overlays = new Map();
  for (const [path, originalSource] of files) {
    if (!path.startsWith('dist/') || !path.endsWith('.js')) continue;
    const source = path === 'dist/state.js'
      ? originalSource.replace(/BUILD_VERSION\s*=\s*['"]v[^'"]+['"]/, "BUILD_VERSION = 'v4.4.0'")
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
  restorePreferences(initialPreferences);
  installPreferencePersistence();
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
