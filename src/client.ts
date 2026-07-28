import './index.css';
import { createRoot } from 'react-dom/client';
import { createElement } from 'react';
import { mountWorkbench } from './workbench';

const legacy = document.createElement('div');
legacy.id = 'runtime-controls';
legacy.hidden = true;
document.body.append(legacy);
mountWorkbench(legacy);

const root = createRoot(document.querySelector('#app')!);
void import('./editor').then(({ Editor }) => root.render(createElement(Editor)));

void import('../runtime/app.js').then(() => {
  const canvas = document.querySelector<HTMLCanvasElement>('#scene');
  document.querySelector('#viewport-canvas')?.append(canvas!);
});
