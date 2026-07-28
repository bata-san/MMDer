# Extractable components

## ViewerShell
- Source: `index.html`
- Category: layout
- Description: fixed workspace shell with asset and inspector docks around a WebGL viewport.
- Extractable props: activeTab, assetsOpen, inspectorOpen.
- Hardcoded: MMD LAB mark, local status labels, workspace regions.

## InspectorTabs
- Source: `src/notion-kit-toolbar.ts`
- Category: layout
- Description: five-section inspector navigation.
- Extractable props: activeTab.
- Hardcoded: motion, life, dynamics, morph, look labels.

