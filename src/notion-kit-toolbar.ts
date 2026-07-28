import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { Badge, Button } from '@notion-kit/ui/primitives';
import '@notion-kit/ui/style.css';

const trigger = (id: string): void => document.querySelector<HTMLElement>(`#${id}`)?.click();

export function mountNotionKitToolbar(): void {
  const host = document.querySelector<HTMLElement>('#notion-kit-toolbar');
  if (!host || host.dataset.mounted) return;
  host.dataset.mounted = 'true';
  const h = createElement;
  createRoot(host).render(h('div', { className: 'nk-toolbar' },
    h(Badge, { variant: 'gray' }, 'LOCAL'),
    h(Button, { size: 'sm', onClick: () => trigger('open-models') }, 'モデルを追加'),
    h(Button, { size: 'sm', variant: 'soft-blue', onClick: () => trigger('open-motions') }, 'モーション'),
    h(Button, { size: 'sm', variant: 'hint', onClick: () => trigger('open-folder') }, 'フォルダ'),
  ));
}

export function mountNotionKitTabs(): void {
  const host = document.querySelector<HTMLElement>('#notion-kit-tabs');
  if (!host || host.dataset.mounted) return;
  host.dataset.mounted = 'true';
  const h = createElement;
  const tabs = [
    ['motion', '再生'], ['life', '生命感'], ['dynamics', '物理'], ['morph', '表情'], ['look', '表示'],
  ] as const;
  const activate = (tab: string): void => document.querySelector<HTMLButtonElement>(`.tabs button[data-tab="${tab}"]`)?.click();
  createRoot(host).render(h('nav', { className: 'nk-tabs', 'aria-label': 'インスペクター' },
    ...tabs.map(([id, label]) => h(Button, {
      key: id,
      size: 'sm',
      variant: id === 'motion' ? 'soft-blue' : 'hint',
      onClick: (event) => {
        const current = host.querySelector<HTMLElement>('.nk-tab-active');
        current?.classList.remove('nk-tab-active');
        (event.currentTarget as HTMLElement).classList.add('nk-tab-active');
        activate(id);
      },
      className: id === 'motion' ? 'nk-tab-active' : undefined,
    }, label)),
  ));
}
