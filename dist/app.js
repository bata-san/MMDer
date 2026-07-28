const PATCH_CHUNKS = 9;
const THREE_VERSION = '0.166.1';
const PREFERENCE_KEY = 'mmd-lab-preferences-v3';
const BUILD_VERSION = 'v5.0.0';
const decoder = new TextDecoder();

const EXCLUDED_CONTROL_IDS = new Set([
  'library-toggle', 'inspector-toggle', 'models-file', 'motions-file', 'folder', 'hdri',
  'timeline', 'rig-edit', 'show-hdri',
]);

function addStyle(id, relativeUrl) {
  if (document.querySelector(`#${id}`)) return;
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = new URL(relativeUrl, import.meta.url).href;
  document.head.append(link);
}

function lifeRange(id, label, min, max, step, value, suffix = '') {
  return `<div class="parameter-row"><label>${label} <output id="${id}-value">${Number(value).toFixed(step < 1 ? 2 : 0)}${suffix}</output></label><input id="${id}" data-life-output="${suffix}" type="range" min="${min}" max="${max}" step="${step}" value="${value}"></div>`;
}

function lifeMotionRegionRanges() {
  return [
    ['life-motion-center', '重心・センター'],
    ['life-motion-hips', '骨盤・下半身'],
    ['life-motion-spine-lower', '上半身'],
    ['life-motion-spine-upper', '胸郭・上半身2'],
    ['life-motion-shoulder-left', '左肩'],
    ['life-motion-shoulder-right', '右肩'],
    ['life-motion-neck', '首'],
    ['life-motion-head', '頭'],
  ].map(([id, label]) => lifeRange(id, label, .55, 1.45, .01, 1, '×')).join('');
}

function installLifePanel() {
  const tab = document.querySelector('#life-tab');
  if (!tab || document.querySelector('#life-engine-card')) return;
  const panel = document.createElement('section');
  panel.id = 'life-engine-card';
  panel.className = 'control-card life-engine-card';
  panel.innerHTML = `
    <div class="section-title"><span>Autonomous Life Engine</span><b class="life-engine-badge">MOTION AWARE</b></div>
    <p id="life-analysis-summary" class="life-analysis-summary">標準待機VMD: 4.00秒 / 104キー / 主動作8ボーン。モデル読み込み後に実際のクリップとPMX剛体を再解析します。</p>
    <p id="life-mind-status" class="life-mind-status">内部状態を準備中</p>
    <div class="control-grid life-core-grid">
      ${lifeRange('life-autonomy', '自律性', 0, 1, .01, .66)}
      ${lifeRange('life-motion-preservation', '元モーション保持', 0, 1, .01, .88)}
      ${lifeRange('life-posture-variation', '姿勢変化', 0, 1, .01, .42)}
      ${lifeRange('life-weight-shift', '重心移動', 0, 1, .01, .36)}
      ${lifeRange('life-smoothness', '身体の滑らかさ', 0, 1, .01, .8)}
      ${lifeRange('life-contact-response', '接触反応', 0, 1, .01, .62)}
    </div>
  `;
  const feature = tab.querySelector('.feature-card');
  if (feature?.nextSibling) tab.insertBefore(panel, feature.nextSibling);
  else tab.prepend(panel);

  const details = document.createElement('details');
  details.className = 'advanced-block life-editor-block';
  details.innerHTML = `
    <summary>解析済み待機モーション・身体状態の編集</summary>
    <div class="advanced-body">
      <p id="life-analysis-regions" class="life-analysis-regions">動作振幅を解析中</p>
      <div class="life-editor-grid">
        ${lifeRange('life-idle-tempo', '待機テンポ', .65, 1.35, .01, 1, '×')}
        ${lifeRange('life-idle-variation', 'テンポの自然変動', 0, .35, .01, .12)}
        ${lifeRange('life-motion-gain', '全身モーション振幅', .65, 1.3, .01, 1, '×')}
        ${lifeRange('life-head-gain', '頭・首の元動作', .65, 1.3, .01, 1, '×')}
        ${lifeRange('life-torso-gain', '胴体の元動作', .65, 1.3, .01, 1, '×')}
        ${lifeRange('life-hips-gain', '骨盤・重心の元動作', .65, 1.3, .01, 1, '×')}
        ${lifeRange('life-shoulder-gain', '肩の元動作', .65, 1.3, .01, 1, '×')}
        ${lifeRange('life-social-awareness', '他モデルへの注意', 0, 1, .01, .28)}
        ${lifeRange('life-fatigue-drift', '長時間の疲労変化', 0, 1, .01, .32)}
        ${lifeRange('life-asymmetry', '自然な左右差', 0, .5, .01, .18)}
        ${lifeRange('life-pose-hold', '姿勢の保持時間', 0, 1, .01, .55)}
        ${lifeRange('life-max-angular-speed', '最大角速度', 20, 100, 1, 55, '°/s')}
      </div>
      <div class="section-title life-subheading"><span>解析済みVMDの部位別振幅</span><small>0.55–1.45×</small></div>
      <div id="life-motion-regions" class="life-editor-grid life-motion-regions">${lifeMotionRegionRanges()}</div>
      <p class="muted">元VMDの骨別振幅を毎回解析し、動いている部位ほど手続き的な加算を自動的に抑えます。部位別倍率は元モーションの初期姿勢からの回転差だけを編集します。全追加動作は角速度制限と臨界減衰を通過します。</p>
    </div>`;
  tab.append(details);
}

function installShellUi() {
  addStyle('theme-performance-style', '../theme-performance.css?v=mmd-lab-5-0-0');
  addStyle('life-system-style', '../life-system.css?v=mmd-lab-5-0-0');
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
  installLifePanel();
  const build = document.querySelector('#build-version');
  if (build) build.textContent = BUILD_VERSION;
}

function readPreferences() {
  for (const key of [PREFERENCE_KEY, 'mmd-lab-preferences-v2']) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || '{}');
      if (value && typeof value === 'object' && Object.keys(value).length) return value;
    } catch { /* malformed old preferences are ignored */ }
  }
  return {};
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
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', next === 'light' ? '#eef1f5' : '#0b0e14');
  if (notify) window.dispatchEvent(new CustomEvent('mmdlab-theme-change', { detail: { theme: next } }));
  return next;
}

function setBaselineControl(id, value, suffix = '') {
  const element = document.querySelector(`#${id}`);
  if (!(element instanceof HTMLInputElement)) return;
  element.value = String(value);
  const output = document.querySelector(`#${id}-value`);
  if (output) output.textContent = `${Number(value).toFixed(id === 'breath-rate' ? 1 : 2)}${suffix}`;
}

function applyNaturalDefaults(preferences) {
  const controls = preferences.controls && typeof preferences.controls === 'object' ? preferences.controls : {};
  const defaults = [
    ['blink-strength', .72, ''], ['blink-activity', .48, ''], ['blink-duration', .9, ''],
    ['double-blink', .09, ''], ['breath-rate', 13.5, ' bpm'], ['breath-depth', .2, ''],
    ['gaze-activity', .44, ''], ['gaze-range', .38, ''], ['gaze-dwell', .62, ''],
    ['head-follow', .18, ''], ['micro-saccade', .22, ''], ['sway', .17, ''],
    ['sway-speed', .38, ''], ['sway-irregularity', .28, ''],
  ];
  defaults.forEach(([id, value, suffix]) => {
    if (!controls[`id:${id}`]) setBaselineControl(id, value, suffix);
  });
}

function wireLifeOutputs() {
  document.querySelectorAll('input[data-life-output]').forEach((element) => {
    const update = () => {
      const output = document.querySelector(`#${element.id}-value`);
      if (!output) return;
      const suffix = element.dataset.lifeOutput || '';
      const step = Number(element.step);
      const digits = step >= 1 ? 0 : 2;
      output.textContent = `${Number(element.value).toFixed(digits)}${suffix}`;
    };
    element.addEventListener('input', update);
    update();
  });
}

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
    const size = Number.parseInt(tarText(header, 124, 12) || '0', 8);
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
    version: 3,
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
    } else if (saved.kind === 'value') {
      element.value = String(saved.value);
      element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
    }
  });
  if (preferences.details && typeof preferences.details === 'object') {
    document.querySelectorAll('details').forEach((element, index) => {
      if (String(index) in preferences.details) element.open = Boolean(preferences.details[String(index)]);
    });
  }
  const activeTab = preferences.activeTab || 'motion';
  const tab = [...document.querySelectorAll('.tabs button')].find((button) => button.dataset.tab === activeTab);
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

async function mergePatch(files, relativeUrl, options = {}) {
  const response = await fetch(new URL(relativeUrl, import.meta.url), { cache: options.cache || 'no-store' });
  if (!response.ok) throw new Error(`${options.label || 'Runtime patch'} is unavailable.`);
  const archive = await decompressGzip(decodeBase64(await response.text()));
  for (const [path, source] of parseTar(archive)) files.set(path, source);
}

async function mergeChunkedPatch(files, directory, count, label) {
  const urls = Array.from({ length: count }, (_, index) =>
    new URL(`${directory}/chunk-${String(index).padStart(2, '0')}?v=mmd-lab-5-0-0`, import.meta.url),
  );
  const chunks = await Promise.all(urls.map(async (url) => {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`${label} chunk unavailable: ${url.pathname}`);
    return response.text();
  }));
  const archive = await decompressGzip(decodeBase64(chunks.join('')));
  for (const [path, source] of parseTar(archive)) files.set(path, source);
}

async function loadVerifiedApplication() {
  const status = document.querySelector('#notice');
  if (status) status.textContent = 'VERIFYING LIFE RUNTIME…';

  const chunkUrls = Array.from({ length: PATCH_CHUNKS }, (_, index) =>
    new URL(`../assets/verified-patch/chunk-${String(index).padStart(2, '0')}`, import.meta.url),
  );
  const chunks = await Promise.all(chunkUrls.map(async (url) => {
    const response = await fetch(url, { cache: 'force-cache' });
    if (!response.ok) throw new Error(`Patch chunk unavailable: ${url.pathname}`);
    return response.text();
  }));
  const files = parseTar(await decompressGzip(decodeBase64(chunks.join(''))));
  await mergePatch(files, '../assets/performance-patch?v=mmd-lab-5-0-0', { label: 'Performance runtime patch' });
  await mergeChunkedPatch(files, '../assets/life-runtime', 6, 'Life runtime patch');

  const overlays = new Map();
  for (const [path, originalSource] of files) {
    if (!path.startsWith('dist/') || !path.endsWith('.js')) continue;
    const source = path === 'dist/state.js'
      ? originalSource.replace(/BUILD_VERSION\s*=\s*['"]v[^'"]+['"]/, `BUILD_VERSION = '${BUILD_VERSION}'`)
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
      for (const match of source.matchAll(/\b(?:from|import)\s*['"](\.[^'"]+)['"]/g)) relativeSpecifiers.add(match[1]);
      for (const specifier of relativeSpecifiers) {
        const dependencyUrl = new URL(specifier, normalizedUrl).href;
        source = replaceSpecifier(source, specifier, await buildModule(dependencyUrl));
      }
      return URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    })();
    cache.set(normalizedUrl, promise);
    return promise;
  }

  await import(await buildModule(new URL('./app.js', import.meta.url).href));
}

installShellUi();
const initialPreferences = readPreferences();
applyNaturalDefaults(initialPreferences);
applyTheme(initialPreferences.theme, false);
wireLifeOutputs();

loadVerifiedApplication().then(() => {
  restorePreferences(initialPreferences);
  wireLifeOutputs();
  installPreferencePersistence();
}).catch((error) => {
  console.error('Verified runtime failed to start.', error);
  const status = document.querySelector('#notice');
  if (status) status.textContent = 'RUNTIME LOAD ERROR';
  const toast = document.querySelector('#toast');
  if (toast) {
    toast.textContent = `起動に失敗しました: ${error instanceof Error ? error.message : String(error)}`;
    toast.classList.add('show');
  }
});
