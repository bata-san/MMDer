# Components

The current UI is primarily static HTML with small React islands. No shared application UI primitive directory exists.

## NotionKitToolbar
- Source: `src/notion-kit-toolbar.ts`
- Description: React island that mounts quick actions and inspector tabs.

```ts
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { Badge, Button } from '@notion-kit/ui/primitives';
const trigger = (id: string): void => document.querySelector<HTMLElement>(`#${id}`)?.click();
export function mountNotionKitToolbar(): void { /* mounts model, motion and folder actions */ }
export function mountNotionKitTabs(): void { /* mounts motion, life, dynamics, morph, look tabs */ }
```

