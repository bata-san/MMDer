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

export async function saveAsset(file: File, kind: AssetKind, path = ''): Promise<StoredAsset> {
  const asset: StoredAsset = {
    id: `${kind}:${file.name}:${file.size}:${file.lastModified}:${path}`,
    kind,
    name: file.name,
    path,
    file,
    savedAt: Date.now(),
  };
  await dbCall('readwrite', (store) => store.put(asset));
  return asset;
}

export async function removeStoredAsset(id: string): Promise<void> {
  await dbCall('readwrite', (store) => store.delete(id));
  state.assets = state.assets.filter((asset) => asset.id !== id);
}

export async function refreshStoredAssets(): Promise<StoredAsset[]> {
  state.assets = await dbCall<StoredAsset[]>('readonly', (store) => store.getAll());
  return state.assets;
}
