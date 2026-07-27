import { extension } from './dom.js';
import { applyMotion } from './motion.js';
import { loadModel } from './models.js';
import { refreshStoredAssets, saveAsset } from './storage.js';
function mimeFor(name) {
    const suffix = extension({ name });
    return {
        png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', bmp: 'image/bmp',
        spa: 'image/bmp', sph: 'image/bmp', tga: 'image/x-tga', dds: 'image/vnd-ms.dds',
        webp: 'image/webp',
    }[suffix] ?? '';
}
async function expandArchives(files) {
    const expanded = [];
    for (const file of [...files]) {
        if (extension(file) !== 'zip') {
            expanded.push(file);
            continue;
        }
        const { unzipSync } = await import('https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js');
        const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
        for (const [path, data] of Object.entries(entries)) {
            if (!data.length || path.endsWith('/'))
                continue;
            const name = path.split('/').pop() ?? path;
            const entry = new File([data], name, { type: mimeFor(name) });
            Object.defineProperty(entry, 'webkitRelativePath', { value: path });
            expanded.push(entry);
        }
    }
    return expanded;
}
function kindFor(file) {
    const suffix = extension(file);
    if (['pmx', 'pmd'].includes(suffix))
        return 'model';
    if (['vmd', 'vpd'].includes(suffix))
        return 'motion';
    if (['png', 'jpg', 'jpeg', 'bmp', 'tga', 'dds', 'webp', 'spa', 'sph'].includes(suffix))
        return 'texture';
    return null;
}
export async function importAssets(files, loadImmediately = false) {
    const saved = [];
    for (const file of await expandArchives(files)) {
        const kind = kindFor(file);
        if (!kind)
            continue;
        saved.push(await saveAsset(file, kind, file.webkitRelativePath || ''));
    }
    await refreshStoredAssets();
    if (loadImmediately) {
        for (const asset of saved.filter((item) => item.kind === 'model'))
            await loadModel(asset.file);
        for (const asset of saved.filter((item) => item.kind === 'motion'))
            await applyMotion(asset.file);
    }
    return saved;
}
