import { state } from './state.js';
import type { AssetKind, StoredAsset } from './types.js';

const database = new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open('mmd-lab-assets', 1);
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains('assets')) {
      request.result.createObjectStore('assets', { keyPath: 'id' });
    }
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

function dbCall<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return database.then((db) => new Promise<T>((resolve, reject) => {
    const transaction = db.transaction('assets', mode);
    const request = work(transaction.objectStore('assets'));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}

export function createStoredAsset(file: File, kind: AssetKind, path = ''): StoredAsset {
  return {
    id: `${kind}:${file.name}:${file.size}:${file.lastModified}:${path}`,
    kind,
    name: file.name,
    path,
    file,
    savedAt: Date.now(),
  };
}

export function mergeStoredAssets(assets: StoredAsset[]): void {
  if (!assets.length) return;
  const merged = new Map(state.assets.map((asset) => [asset.id, asset]));
  assets.forEach((asset) => merged.set(asset.id, asset));
  state.assets = [...merged.values()];
}

export async function saveAssets(assets: StoredAsset[]): Promise<StoredAsset[]> {
  if (!assets.length) return assets;
  const db = await database;
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('assets', 'readwrite');
    const store = transaction.objectStore('assets');
    assets.forEach((asset) => store.put(asset));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error('Asset storage transaction was aborted.'));
  });
  return assets;
}

export async function saveAsset(file: File, kind: AssetKind, path = ''): Promise<StoredAsset> {
  const asset = createStoredAsset(file, kind, path);
  mergeStoredAssets([asset]);
  await saveAssets([asset]);
  return asset;
}

export async function removeStoredAsset(id: string): Promise<void> {
  await dbCall('readwrite', (store) => store.delete(id));
  state.assets = state.assets.filter((asset) => asset.id !== id);
}

export async function removeStoredAssets(kind?: AssetKind): Promise<void> {
  const targets = state.assets.filter((asset) => !kind || asset.kind === kind);
  await Promise.all(targets.map((asset) => dbCall('readwrite', (store) => store.delete(asset.id))));
  state.assets = state.assets.filter((asset) => kind && asset.kind !== kind);
}

export async function refreshStoredAssets(): Promise<StoredAsset[]> {
  state.assets = await dbCall<StoredAsset[]>('readonly', (store) => store.getAll());
  return state.assets;
}
