import './index.css';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { createElement } from 'react';

const root = createRoot(document.querySelector('#app')!);
void (async () => {
  const { Editor } = await import('./editor');
  flushSync(() => root.render(createElement(Editor)));
  const canvas = document.querySelector<HTMLCanvasElement>('#scene');
  const viewport = document.querySelector('#viewport-canvas');
  if (!canvas || !viewport) throw new Error('Editor viewport failed to mount.');
  viewport.append(canvas);
  await import('../runtime/app.js');
  if (new URLSearchParams(location.search).has('ik-lab')) {
    const { startIkLab } = await import('./ik-lab');
    void startIkLab();
  }
  if (new URLSearchParams(location.search).has('life-lab')) {
    const { startLifeLab } = await import('./life-lab');
    void startLifeLab();
  }
  window.dispatchEvent(new Event('resize'));
})();
