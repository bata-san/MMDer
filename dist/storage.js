import { state } from './state.js';
const database = new Promise((resolve, reject) => {
    const request = indexedDB.open('mmd-lab-assets', 1);
    request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('assets')) {
            request.result.createObjectStore('assets', { keyPath: 'id' });
        }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
});
function dbCall(mode, work) {
    return database.then((db) => new Promise((resolve, reject) => {
        const transaction = db.transaction('assets', mode);
        const request = work(transaction.objectStore('assets'));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    }));
}
export async function saveAsset(file, kind, path = '') {
    const asset = {
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
export async function removeStoredAsset(id) {
    await dbCall('readwrite', (store) => store.delete(id));
    state.assets = state.assets.filter((asset) => asset.id !== id);
}
export async function refreshStoredAssets() {
    state.assets = await dbCall('readonly', (store) => store.getAll());
    return state.assets;
}
