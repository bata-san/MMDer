type WorkerKind = 'unzip' | 'parse-model' | 'warm-model-parser';
type PendingRequest = { resolve: (value: any) => void; reject: (reason?: unknown) => void };

let worker: Worker | null = null;
let nextRequestId = 1;
let prewarmScheduled = false;
const pending = new Map<number, PendingRequest>();

function rejectPending(error: Error): void {
  pending.forEach(({ reject }) => reject(error));
  pending.clear();
}

function workerInstance(): Worker | null {
  if (worker) return worker;
  if (typeof Worker === 'undefined') return null;
  try {
    worker = new Worker(new URL('./pipeline-worker.js', import.meta.url), { type: 'module', name: 'mmd-lab-pipeline' });
    worker.onmessage = (event: MessageEvent<{ id: number; ok: boolean; result?: any; error?: string }>) => {
      const request = pending.get(event.data.id);
      if (!request) return;
      pending.delete(event.data.id);
      if (event.data.ok) request.resolve(event.data.result);
      else request.reject(new Error(event.data.error || 'Worker task failed.'));
    };
    worker.onerror = (event) => {
      const error = new Error(event.message || 'MMD pipeline worker stopped.');
      rejectPending(error);
      worker?.terminate();
      worker = null;
    };
    return worker;
  } catch (error) {
    console.warn('MMD pipeline worker is unavailable.', error);
    worker = null;
    return null;
  }
}

function requestWorker<T>(kind: WorkerKind, payload: Record<string, unknown> = {}, transfer: Transferable[] = []): Promise<T> {
  const target = workerInstance();
  if (!target) return Promise.reject(new Error('Web Worker is unavailable.'));
  const id = nextRequestId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    try {
      target.postMessage({ id, kind, ...payload }, transfer);
    } catch (error) {
      pending.delete(id);
      reject(error);
    }
  });
}

export async function expandZipInWorker(file: File): Promise<{ path: string; buffer: ArrayBuffer }[] | null> {
  try {
    const buffer = await file.arrayBuffer();
    return await requestWorker('unzip', { buffer }, [buffer]);
  } catch (error) {
    console.warn(`${file.name}: worker ZIP extraction fell back to the main thread.`, error);
    return null;
  }
}

export async function parseMmdModelInWorker(file: File): Promise<{ format: 'pmd' | 'pmx'; data: any } | null> {
  try {
    const buffer = await file.arrayBuffer();
    return await requestWorker('parse-model', { buffer }, [buffer]);
  } catch (error) {
    console.warn(`${file.name}: worker model parsing fell back to MMDLoader.`, error);
    return null;
  }
}

export function prewarmModelWorker(): void {
  if (prewarmScheduled || typeof Worker === 'undefined') return;
  prewarmScheduled = true;
  const warm = () => { void requestWorker('warm-model-parser').catch(() => undefined); };
  if ('requestIdleCallback' in window) window.requestIdleCallback(warm, { timeout: 2200 });
  else globalThis.setTimeout(warm, 700);
}
