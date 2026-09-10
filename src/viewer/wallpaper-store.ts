import type { ScreenName } from './types';

function openStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('iphone-duo-wallpapers', 1);
    let failed = false;
    request.onupgradeneeded = () => request.result.createObjectStore('wallpapers');
    request.onerror = () => reject(request.error);
    request.onblocked = () => { failed = true; reject(new Error('本地壁纸存储暂不可用')); };
    request.onsuccess = () => {
      if (failed) request.result.close();
      else resolve(request.result);
    };
  });
}

async function transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openStore();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction('wallpapers', mode);
      const request = action(tx.objectStore('wallpapers'));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error ?? request.error);
      tx.onabort = () => reject(tx.error ?? new Error('本地保存被中断'));
    });
  } finally { db.close(); }
}

export async function readWallpaper(screen: ScreenName): Promise<Blob | null> {
  const value: unknown = await transaction('readonly', (store) => store.get(screen));
  return value instanceof Blob ? value : null;
}

export async function writeWallpaper(screen: ScreenName, blob: Blob | null): Promise<void> {
  if (blob) await transaction('readwrite', (store) => store.put(blob, screen));
  else await transaction('readwrite', (store) => store.delete(screen));
}
