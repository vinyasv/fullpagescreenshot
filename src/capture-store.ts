import type { CaptureRecord } from './types';

const DATABASE = 'fullpage-screenshot-captures';
const STORE = 'items';
let database: Promise<IDBDatabase> | undefined;

function openDatabase(): Promise<IDBDatabase> {
  if (database) return database;
  database = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open temporary capture storage.'));
  });
  return database;
}

async function put(key: string, value: unknown): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).put(value, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('Could not store temporary capture data.'));
    transaction.onabort = () => reject(transaction.error || new Error('Temporary capture storage was interrupted.'));
  });
}

async function get<T>(key: string): Promise<T | undefined> {
  const db = await openDatabase();
  return new Promise<T | undefined>((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error || new Error('Could not read temporary capture data.'));
  });
}

export function saveCaptureTile(id: string, index: number, dataUrl: string) {
  return put(`tile:${id}:${index}`, dataUrl);
}

export function readCaptureTile(id: string, index: number) {
  return get<string>(`tile:${id}:${index}`);
}

export function saveCaptureRecord(record: CaptureRecord) {
  return put(`capture:${record.id}`, record);
}

export function readCaptureRecord(id: string) {
  return get<CaptureRecord>(`capture:${id}`);
}

export async function deleteCapture(id: string, count: number): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite');
    const store = transaction.objectStore(STORE);
    store.delete(`capture:${id}`);
    for (let index = 0; index < count; index++) store.delete(`tile:${id}:${index}`);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('Could not delete temporary capture data.'));
    transaction.onabort = () => reject(transaction.error || new Error('Temporary capture cleanup was interrupted.'));
  });
}
