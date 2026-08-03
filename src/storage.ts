import type { RepostRecord, RunState } from './shared';

const DB_NAME = 'tiktok-repost-remover';
const STORE_NAME = 'reposts';

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error ?? new Error('IndexedDB request failed.'));
  });
}

function transactionDone(value: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    value.oncomplete = () => resolve();
    value.onerror = () => reject(value.error ?? new Error('IndexedDB transaction failed.'));
    value.onabort = () => reject(value.error ?? new Error('IndexedDB transaction was aborted.'));
  });
}

async function database(): Promise<IDBDatabase> {
  const open = indexedDB.open(DB_NAME, 1);
  open.onupgradeneeded = () => open.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
  return request(open);
}

export async function clearItems(): Promise<void> {
  const db = await database();
  const transaction = db.transaction(STORE_NAME, 'readwrite');
  transaction.objectStore(STORE_NAME).clear();
  await transactionDone(transaction);
  db.close();
}

export async function addItems(items: Omit<RepostRecord, 'selected' | 'status' | 'error' | 'updatedAt' | 'scanPage'>[], scanPage: number): Promise<number> {
  const db = await database();
  const transaction = db.transaction(STORE_NAME, 'readwrite');
  const store = transaction.objectStore(STORE_NAME);
  let added = 0;
  for (const item of items) {
    const get = store.get(item.id);
    get.onsuccess = () => {
      if (get.result) return;
      store.add({ ...item, selected: true, status: 'pending', error: '', updatedAt: Date.now(), scanPage } satisfies RepostRecord);
      added += 1;
    };
  }
  await transactionDone(transaction);
  db.close();
  return added;
}

export async function getItems(): Promise<RepostRecord[]> {
  const db = await database();
  const items = await request(db.transaction(STORE_NAME).objectStore(STORE_NAME).getAll()) as RepostRecord[];
  db.close();
  return items;
}

export async function updateItem(id: string, patch: Partial<RepostRecord>): Promise<RepostRecord | null> {
  const db = await database();
  const transaction = db.transaction(STORE_NAME, 'readwrite');
  const store = transaction.objectStore(STORE_NAME);
  const item = await request(store.get(id)) as RepostRecord | undefined;
  if (!item) {
    await transactionDone(transaction);
    db.close();
    return null;
  }
  const updated = { ...item, ...patch, updatedAt: Date.now() };
  store.put(updated);
  await transactionDone(transaction);
  db.close();
  return updated;
}

export async function updateItems(ids: string[] | undefined, update: (item: RepostRecord) => Partial<RepostRecord>): Promise<void> {
  const allowed = ids ? new Set(ids) : null;
  const db = await database();
  const transaction = db.transaction(STORE_NAME, 'readwrite');
  const store = transaction.objectStore(STORE_NAME);
  const cursor = store.openCursor();
  cursor.onsuccess = () => {
    const entry = cursor.result;
    if (!entry) return;
    const item = entry.value as RepostRecord;
    if (!allowed || allowed.has(item.id)) entry.update({ ...item, ...update(item), updatedAt: Date.now() });
    entry.continue();
  };
  await transactionDone(transaction);
  db.close();
}

export async function nextPendingItem(): Promise<RepostRecord | null> {
  const items = await getItems();
  const next = items.find((item) => item.selected && item.status === 'pending');
  return next ? updateItem(next.id, { status: 'removing' }) : null;
}

export async function counts(): Promise<Pick<RunState, 'collected' | 'selected' | 'removed' | 'failed' | 'remaining'>> {
  const items = await getItems();
  return {
    collected: items.length,
    selected: items.filter(({ selected }) => selected).length,
    removed: items.filter(({ status }) => status === 'removed').length,
    failed: items.filter(({ status }) => status === 'failed').length,
    remaining: items.filter(({ selected, status }) => selected && status !== 'removed').length
  };
}

export async function verificationPageLimit(fallback: number): Promise<number> {
  const selected = (await getItems()).filter(({ selected }) => selected);
  return Math.max(1, ...selected.map(({ scanPage }) => scanPage ?? fallback));
}
