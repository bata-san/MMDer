import { extension, setNotice, toast } from './dom.js';
import { applyMotion } from './motion.js';
import { loadModel } from './models.js';
import { createStoredAsset, mergeStoredAssets, saveAssets } from './storage.js';
import type { AssetKind, StoredAsset } from './types.js';
import { expandZipInWorker } from './worker-client.js';

function mimeFor(name: string): string {
  const suffix = extension({ name } as File);
  return ({
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', bmp: 'image/bmp',
    spa: 'image/bmp', sph: 'image/bmp', tga: 'image/x-tga', dds: 'image/vnd-ms.dds',
    webp: 'image/webp',
  } as Record<string, string>)[suffix] ?? '';
}

function archiveEntry(path: string, buffer: ArrayBuffer, lastModified: number): File {
  const name = path.split('/').pop() ?? path;
  const entry = new File([buffer], name, { type: mimeFor(name), lastModified });
  Object.defineProperty(entry, 'webkitRelativePath', { value: path });
  return entry;
}

async function expandArchive(file: File): Promise<File[]> {
  const workerEntries = await expandZipInWorker(file);
  if (workerEntries) {
    return workerEntries
      .filter((entry) => entry.buffer.byteLength && !entry.path.endsWith('/'))
      .map((entry) => archiveEntry(entry.path, entry.buffer, file.lastModified));
  }
  const { unzipSync } = await import('https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js');
  const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
  return Object.entries(entries as Record<string, Uint8Array>)
    .filter(([path, data]) => data.length && !path.endsWith('/'))
    .map(([path, data]) => archiveEntry(path, data.slice().buffer, file.lastModified));
}

async function expandArchives(files: FileList | File[]): Promise<File[]> {
  const source = [...files];
  const expandedByIndex: File[][] = new Array(source.length);
  let cursor = 0;
  const consume = async (): Promise<void> => {
    while (cursor < source.length) {
      const index = cursor++;
      const file = source[index];
      expandedByIndex[index] = extension(file) === 'zip' ? await expandArchive(file) : [file];
    }
  };
  await Promise.all(Array.from({ length: Math.min(2, source.length) }, consume));
  return expandedByIndex.flat();
}

function kindFor(file: File): AssetKind | null {
  const suffix = extension(file);
  if (['pmx', 'pmd'].includes(suffix)) return 'model';
  if (['vmd', 'vpd'].includes(suffix)) return 'motion';
  if (['png', 'jpg', 'jpeg', 'bmp', 'tga', 'dds', 'webp', 'spa', 'sph'].includes(suffix)) return 'texture';
  return null;
}

async function yieldMainThread(): Promise<void> {
  const schedulerApi = (globalThis as any).scheduler;
  if (schedulerApi?.yield) {
    await schedulerApi.yield();
    return;
  }
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

export async function importAssets(files: FileList | File[], loadImmediately = false): Promise<StoredAsset[]> {
  const startedAt = performance.now();
  setNotice('PREPARING ASSETS…');
  const expanded = await expandArchives(files);
  const staged = expanded.flatMap((file) => {
    const kind = kindFor(file);
    return kind ? [createStoredAsset(file, kind, file.webkitRelativePath || '')] : [];
  });

  // Make textures available to LoadingManager immediately. Persistent cloning of large files
  // is deliberately postponed until after the first model is visible.
  mergeStoredAssets(staged);

  if (loadImmediately) {
    for (const asset of staged.filter((item) => item.kind === 'model')) {
      await yieldMainThread();
      await loadModel(asset.file);
    }
    for (const asset of staged.filter((item) => item.kind === 'motion')) {
      await yieldMainThread();
      await applyMotion(asset.file);
    }
  }

  const persist = () => {
    void saveAssets(staged).catch((error) => {
      console.warn('Asset persistence failed.', error);
      toast('一部のファイルを保存できませんでした');
    });
  };
  if ('requestIdleCallback' in window) window.requestIdleCallback(persist, { timeout: 6000 });
  else globalThis.setTimeout(persist, loadImmediately ? 500 : 80);

  setNotice();
  console.info(`Prepared ${staged.length} MMD assets in ${Math.round(performance.now() - startedAt)} ms.`);
  return staged;
}
