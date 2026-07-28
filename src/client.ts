import '@shoelace-style/shoelace/dist/themes/dark.css';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '../style.css';
import '../theme-performance.css';
import '../life-system.css';
import { mountNotionKitToolbar } from './notion-kit-toolbar.js';

type Theme = 'dark' | 'light';
type SavedControl =
  | { kind: 'checked'; value: boolean }
  | { kind: 'value'; value: string };

interface Preferences {
  version: 4;
  theme: Theme;
  controls: Record<string, SavedControl>;
  details: Record<string, boolean>;
  activeTab: string;
}

const BUILD_VERSION = 'v5.1.0';
const PREFERENCE_KEY = 'mmd-lab-preferences-v4';
const LEGACY_KEYS = ['mmd-lab-preferences-v3', 'mmd-lab-preferences-v2'];
const EXCLUDED_CONTROL_IDS = new Set([
  'library-toggle',
  'inspector-toggle',
  'models-file',
  'motions-file',
  'folder',
  'hdri',
  'timeline',
  'rig-edit',
  'show-hdri',
]);

const $ = <T extends Element>(selector: string): T | null => document.querySelector<T>(selector);

function lifeRange(
  id: string,
  label: string,
  min: number,
  max: number,
  step: number,
  value: number,
  suffix = '',
): string {
  const digits = step >= 1 ? 0 : 2;
  return `<div class="parameter-row"><label>${label} <output id="${id}-value">${value.toFixed(digits)}${suffix}</output></label><input id="${id}" data-life-output="${suffix}" type="range" min="${min}" max="${max}" step="${step}" value="${value}"></div>`;
}

function lifeMotionRegionRanges(): string {
  return [
    ['life-motion-center', '重心・センター'],
    ['life-motion-hips', '骨盤・下半身'],
    ['life-motion-spine-lower', '上半身'],
    ['life-motion-spine-upper', '胸郭・上半身2'],
    ['life-motion-shoulder-left', '左肩'],
    ['life-motion-shoulder-right', '右肩'],
    ['life-motion-neck', '首'],
    ['life-motion-head', '頭'],
  ].map(([id, label]) => lifeRange(id, label, 0.55, 1.45, 0.01, 1, '×')).join('');
}

function installLifePanel(): void {
  const tab = $('#life-tab');
  if (!tab || $('#life-engine-card')) return;

  const panel = document.createElement('section');
  panel.id = 'life-engine-card';
  panel.className = 'control-card life-engine-card';
  panel.innerHTML = `
    <div class="section-title"><span>Autonomous Life Engine</span><b class="life-engine-badge">MOTION AWARE</b></div>
    <p id="life-analysis-summary" class="life-analysis-summary">標準待機VMD: 4.00秒 / 104キー / 主動作8ボーン。モデル読み込み後に実際のクリップとPMX剛体を再解析します。</p>
    <p id="life-mind-status" class="life-mind-status">内部状態を準備中</p>
    <div class="control-grid life-core-grid">
      ${lifeRange('life-autonomy', '自律性', 0, 1, 0.01, 0.66)}
      ${lifeRange('life-motion-preservation', '元モーション保持', 0, 1, 0.01, 0.88)}
      ${lifeRange('life-posture-variation', '姿勢変化', 0, 1, 0.01, 0.42)}
      ${lifeRange('life-weight-shift', '重心移動', 0, 1, 0.01, 0.36)}
      ${lifeRange('life-smoothness', '身体の滑らかさ', 0, 1, 0.01, 0.8)}
      ${lifeRange('life-contact-response', '接触反応', 0, 1, 0.01, 0.62)}
    </div>`;

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
        ${lifeRange('life-idle-tempo', '待機テンポ', 0.65, 1.35, 0.01, 1, '×')}
        ${lifeRange('life-idle-variation', 'テンポの自然変動', 0, 0.35, 0.01, 0.12)}
        ${lifeRange('life-motion-gain', '全身モーション振幅', 0.65, 1.3, 0.01, 1, '×')}
        ${lifeRange('life-head-gain', '頭・首の元動作', 0.65, 1.3, 0.01, 1, '×')}
        ${lifeRange('life-torso-gain', '胴体の元動作', 0.65, 1.3, 0.01, 1, '×')}
        ${lifeRange('life-hips-gain', '骨盤・重心の元動作', 0.65, 1.3, 0.01, 1, '×')}
        ${lifeRange('life-shoulder-gain', '肩の元動作', 0.65, 1.3, 0.01, 1, '×')}
        ${lifeRange('life-social-awareness', '他モデルへの注意', 0, 1, 0.01, 0.28)}
        ${lifeRange('life-fatigue-drift', '長時間の疲労変化', 0, 1, 0.01, 0.32)}
        ${lifeRange('life-asymmetry', '自然な左右差', 0, 0.5, 0.01, 0.18)}
        ${lifeRange('life-pose-hold', '姿勢の保持時間', 0, 1, 0.01, 0.55)}
        ${lifeRange('life-max-angular-speed', '最大角速度', 20, 100, 1, 55, '°/s')}
      </div>
      <div class="section-title life-subheading"><span>解析済みVMDの部位別振幅</span><small>0.55–1.45×</small></div>
      <div id="life-motion-regions" class="life-editor-grid life-motion-regions">${lifeMotionRegionRanges()}</div>
      <p class="muted">元VMDの骨別振幅を毎回解析し、動いている部位ほど手続き的な加算を自動的に抑えます。部位別倍率は元モーションの初期姿勢からの回転差だけを編集します。全追加動作は角速度制限と臨界減衰を通過します。</p>
    </div>`;
  tab.append(details);
}

function applyTheme(theme: Theme, notify = true): void {
  document.documentElement.dataset.theme = theme;
  document.querySelectorAll<HTMLElement>('[data-theme-toggle]').forEach((button) => {
    const label = button.querySelector('b');
    if (label) label.textContent = theme === 'light' ? 'DARK' : 'LIGHT';
    button.setAttribute('aria-pressed', String(theme === 'light'));
    button.title = theme === 'light' ? '黒いテーマへ切り替える' : '白いテーマへ切り替える';
  });
  $('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#eef1f5' : '#0b0e14');
  if (notify) window.dispatchEvent(new CustomEvent('mmdlab-theme-change', { detail: { theme } }));
}

function installShell(): void {
  installLifePanel();

  const build = $('#build-version');
  if (build) build.textContent = BUILD_VERSION;

  const status = $('.status');
  if (status && !$('#load-meter')) {
    const meter = document.createElement('span');
    meter.id = 'load-meter';
    meter.className = 'load-meter';
    meter.hidden = true;
    meter.innerHTML = '<i id="load-progress"></i><b id="load-label">準備中</b>';
    status.append(meter);
  }

  if (status && !$('#theme-toggle')) {
    const button = document.createElement('button');
    button.id = 'theme-toggle';
    button.className = 'theme-toggle';
    button.type = 'button';
    button.dataset.themeToggle = '';
    button.setAttribute('aria-label', '白と黒のテーマを切り替える');
    button.innerHTML = '<span aria-hidden="true">◐</span><b>LIGHT</b>';
    status.append(button);
  }

  const mobileActions = $('.mobile-dock-actions');
  if (mobileActions && !mobileActions.querySelector('[data-theme-toggle]')) {
    const button = document.createElement('button');
    button.className = 'theme-toggle';
    button.type = 'button';
    button.dataset.themeToggle = '';
    button.setAttribute('aria-label', '白と黒のテーマを切り替える');
    button.innerHTML = '<span aria-hidden="true">◐</span>';
    mobileActions.append(button);
  }
}

function controlPreferenceKey(element: HTMLInputElement | HTMLSelectElement): string | null {
  if (element instanceof HTMLInputElement && (element.type === 'file' || element.type === 'button')) return null;
  if (element.id) return EXCLUDED_CONTROL_IDS.has(element.id) ? null : `id:${element.id}`;

  const card = element.closest('.region-card');
  const container = card?.parentElement;
  if (!card || !container?.id) return null;
  const cards = [...container.children].filter((child) => child.classList.contains('region-card'));
  const cardIndex = cards.indexOf(card);
  const inputs = [...card.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input,select')];
  const inputIndex = inputs.indexOf(element);
  const token = element.dataset.key || (element.classList.contains('part-enabled') ? 'enabled' : `control-${inputIndex}`);
  return `dynamic:${container.id}:${cardIndex}:${token}`;
}

function collectPreferences(): Preferences {
  const controls: Record<string, SavedControl> = {};
  document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input,select').forEach((element) => {
    const key = controlPreferenceKey(element);
    if (!key) return;
    controls[key] = element instanceof HTMLInputElement && element.type === 'checkbox'
      ? { kind: 'checked', value: element.checked }
      : { kind: 'value', value: element.value };
  });

  const details: Record<string, boolean> = {};
  document.querySelectorAll<HTMLDetailsElement>('details').forEach((element, index) => {
    details[String(index)] = element.open;
  });

  return {
    version: 4,
    theme: document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',
    controls,
    details,
    activeTab: $('.tabs button.active')?.getAttribute('data-tab') || 'motion',
  };
}

function readPreferences(): Partial<Preferences> {
  for (const key of [PREFERENCE_KEY, ...LEGACY_KEYS]) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || '{}') as Partial<Preferences>;
      if (value && typeof value === 'object' && Object.keys(value).length) return value;
    } catch {
      // Ignore malformed legacy settings.
    }
  }
  return {};
}

function savePreferences(): void {
  try {
    localStorage.setItem(PREFERENCE_KEY, JSON.stringify(collectPreferences()));
  } catch {
    // Private browsing and exhausted quota must not interrupt rendering.
  }
}

function restoreControls(preferences: Partial<Preferences>, restored: WeakSet<Element>): void {
  const controls = preferences.controls && typeof preferences.controls === 'object' ? preferences.controls : {};
  document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input,select').forEach((element) => {
    if (restored.has(element)) return;
    const key = controlPreferenceKey(element);
    const saved = key ? controls[key] : undefined;
    if (!saved) return;

    if (element instanceof HTMLInputElement && element.type === 'checkbox' && saved.kind === 'checked') {
      element.checked = Boolean(saved.value);
      element.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (saved.kind === 'value') {
      element.value = String(saved.value);
      element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
    }
    restored.add(element);
  });
}

function restorePreferences(preferences: Partial<Preferences>): void {
  const restored = new WeakSet<Element>();
  restoreControls(preferences, restored);

  if (preferences.details && typeof preferences.details === 'object') {
    document.querySelectorAll<HTMLDetailsElement>('details').forEach((element, index) => {
      const key = String(index);
      if (key in preferences.details!) element.open = Boolean(preferences.details![key]);
    });
  }

  const activeTab = preferences.activeTab || 'motion';
  const tab = [...document.querySelectorAll<HTMLButtonElement>('.tabs button')]
    .find((button) => button.dataset.tab === activeTab);
  tab?.click();

  applyTheme(preferences.theme === 'light' ? 'light' : 'dark', true);

  const observer = new MutationObserver(() => restoreControls(preferences, restored));
  observer.observe(document.body, { childList: true, subtree: true });
  window.setTimeout(() => observer.disconnect(), 5000);
}

function applyNaturalDefaults(preferences: Partial<Preferences>): void {
  const controls = preferences.controls && typeof preferences.controls === 'object' ? preferences.controls : {};
  const defaults: Array<[string, number]> = [
    ['blink-strength', 0.72],
    ['blink-activity', 0.48],
    ['blink-duration', 0.9],
    ['double-blink', 0.09],
    ['breath-rate', 13.5],
    ['breath-depth', 0.2],
    ['gaze-activity', 0.44],
    ['gaze-range', 0.38],
    ['gaze-dwell', 0.62],
    ['head-follow', 0.18],
    ['micro-saccade', 0.22],
    ['sway', 0.17],
    ['sway-speed', 0.38],
    ['sway-irregularity', 0.28],
  ];

  defaults.forEach(([id, value]) => {
    if (controls[`id:${id}`]) return;
    const element = $<HTMLInputElement>(`#${id}`);
    if (element) element.value = String(value);
  });
}

function wireLifeOutputs(): void {
  document.querySelectorAll<HTMLInputElement>('input[data-life-output]').forEach((element) => {
    const update = (): void => {
      const output = $<HTMLOutputElement>(`#${element.id}-value`);
      if (!output) return;
      const suffix = element.dataset.lifeOutput || '';
      const step = Number(element.step);
      output.textContent = `${Number(element.value).toFixed(step >= 1 ? 0 : 2)}${suffix}`;
    };
    element.addEventListener('input', update);
    update();
  });
}

function installPersistence(): void {
  let timer = 0;
  const scheduleSave = (): void => {
    window.clearTimeout(timer);
    timer = window.setTimeout(savePreferences, 140);
  };

  document.addEventListener('input', scheduleSave, true);
  document.addEventListener('change', scheduleSave, true);
  document.addEventListener('toggle', scheduleSave, true);
  document.querySelectorAll('[data-theme-toggle]').forEach((element) => {
    element.addEventListener('click', () => {
      applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light', true);
      savePreferences();
    });
  });
  window.addEventListener('beforeunload', savePreferences);
}

function showFatal(error: unknown): void {
  console.error('MMD LAB startup failed.', error);
  const message = error instanceof Error ? error.message : String(error);
  const notice = $('#notice');
  if (notice) notice.textContent = 'STARTUP ERROR';
  const toast = $('#toast');
  if (toast) {
    toast.textContent = `起動に失敗しました: ${message}`;
    toast.classList.add('show');
  }
}

async function main(): Promise<void> {
  mountNotionKitToolbar();
  installShell();
  const preferences = readPreferences();
  applyNaturalDefaults(preferences);
  applyTheme(preferences.theme === 'light' ? 'light' : 'dark', false);
  wireLifeOutputs();

  await import('../runtime/app.js');

  restorePreferences(preferences);
  wireLifeOutputs();
  installPersistence();
}

void main().catch(showFatal);
