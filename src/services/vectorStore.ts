const DB_NAME = 'smallville_vectors_v2';
const STORE_NAME = 'memory_embeddings';

export const DEFAULT_EMBED_MODEL = 'gemini-embedding-2';
export const DEFAULT_EMBED_DIM = 768;

export function formatQueryEmbedText(query: string): string {
  return `task: search result | query: ${query.trim()}`;
}

export function formatMemoryEmbedText(description: string): string {
  return `title: none | text: ${description.trim()}`;
}

function fallbackDeterministicHash(input: string): string {
  let h1 = 0xdeadbeef ^ input.length;
  let h2 = 0x41c6ce57 ^ input.length;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(h2 >>> 0).toString(16).padStart(8, '0')}${(h1 >>> 0).toString(16).padStart(8, '0')}`;
}

export async function hashEmbeddingText(
  prefixedText: string,
  model = DEFAULT_EMBED_MODEL,
  dimensions = DEFAULT_EMBED_DIM,
): Promise<string> {
  const payload = `${model}:${dimensions}:${prefixedText}`;
  if (typeof crypto !== 'undefined' && crypto.subtle && typeof TextEncoder !== 'undefined') {
    const bytes = new TextEncoder().encode(payload);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const arr = Array.from(new Uint8Array(digest));
    return arr.map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  return fallbackDeterministicHash(payload);
}

function openVectorDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function saveCachedEmbeddings(
  entries: Array<{ hash: string; vector: number[] }>,
): Promise<void> {
  if (entries.length === 0) return;
  const db = await openVectorDb();
  if (!db) return;

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      for (const entry of entries) {
        if (entry.hash && entry.vector.length > 0) {
          store.put(entry.vector, entry.hash);
        }
      }
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    } catch {
      db.close();
      resolve();
    }
  });
}

export async function loadAllCachedEmbeddings(): Promise<Map<string, number[]>> {
  const map = new Map<string, number[]>();
  const db = await openVectorDb();
  if (!db) return map;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          if (typeof cursor.key === 'string' && Array.isArray(cursor.value)) {
            map.set(cursor.key, cursor.value as number[]);
          }
          cursor.continue();
        } else {
          db.close();
          resolve(map);
        }
      };
      req.onerror = () => {
        db.close();
        resolve(map);
      };
    } catch {
      db.close();
      resolve(map);
    }
  });
}

export async function clearCachedEmbeddings(): Promise<void> {
  const db = await openVectorDb();
  if (!db) return;

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    } catch {
      db.close();
      resolve();
    }
  });
}

