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
