import { Button, Dialog, DialogPanel, DialogTitle, Tab, TabGroup, TabList } from '@headlessui/react';
import { createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';

const h = createElement;
const trigger = (id: string): void => document.querySelector<HTMLElement>(`#${id}`)?.click();

function Toolbar(): ReturnType<typeof h> {
  const [open, setOpen] = useState(false);
  return h('div', { className: 'hui-toolbar' },
    h(Button, { className: 'hui-button', onClick: () => trigger('open-models') }, 'モデル'),
    h(Button, { className: 'hui-button hui-button-primary', onClick: () => trigger('open-motions') }, 'モーション'),
    h(Button, { className: 'hui-icon-button', 'aria-label': '表示設定', onClick: () => setOpen(true) }, '☼'),
    h(Dialog, { open, onClose: setOpen, className: 'hui-dialog' },
      h('div', { className: 'hui-backdrop', 'aria-hidden': true }),
      h('div', { className: 'hui-dialog-wrap' }, h(DialogPanel, { className: 'hui-dialog-panel' },
        h(DialogTitle, { className: 'hui-dialog-title' }, '表示設定'),
        h('p', { className: 'muted' }, 'ワークスペースの表示モードを切り替えます。'),
        h(Button, { className: 'hui-button', onClick: () => { document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'; setOpen(false); } }, 'ライト / ダークを切り替え'),
      )),
    ),
  );
}

export function mountNotionKitToolbar(): void {
  const host = document.querySelector<HTMLElement>('#notion-kit-toolbar');
  if (!host || host.dataset.mounted) return;
  host.dataset.mounted = 'true'; createRoot(host).render(h(Toolbar));
}

export function mountNotionKitTabs(): void {
  const host = document.querySelector<HTMLElement>('#notion-kit-tabs');
  if (!host || host.dataset.mounted) return;
  host.dataset.mounted = 'true';
  const tabs = [['motion', '再生'], ['life', '生命感'], ['dynamics', '物理'], ['morph', '表情'], ['look', '表示']] as const;
  createRoot(host).render(h(TabGroup, { as: 'div', className: 'hui-tabs' },
    h(TabList, { className: 'hui-tab-list' }, ...tabs.map(([id, label]) => h(Tab, { key: id, className: 'hui-tab', onClick: () => document.querySelector<HTMLButtonElement>(`.tabs button[data-tab="${id}"]`)?.click() }, label))),
  ));
}
