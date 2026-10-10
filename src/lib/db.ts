// Хранилище на телефоне: IndexedDB (данные не пропадают после закрытия приложения).
// Небольшая собственная обёртка вместо Dexie: меньше кода и работает полностью офлайн.

const DB_NAME = "kitchen";
const DB_VERSION = 1;
export const STORES = ["products", "log", "recipes", "kv"] as const;
export type StoreName = (typeof STORES)[number];

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("products")) db.createObjectStore("products", { keyPath: "id" });
      if (!db.objectStoreNames.contains("log")) db.createObjectStore("log", { keyPath: "id" }).createIndex("t", "t");
      if (!db.objectStoreNames.contains("recipes")) db.createObjectStore("recipes", { keyPath: "id" });
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
    };
    req.onsuccess = () => {
      const db = req.result;
      // Если открыта новая версия приложения в другой вкладке — закрываемся, чтобы не мешать.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("База занята другой вкладкой"));
  });
  return dbPromise;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((res, rej) => {
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error || new Error("Запись отменена"));
  });
}

export async function getAll<T>(store: StoreName): Promise<T[]> {
  const db = await open();
  return new Promise((res, rej) => {
    const r = db.transaction(store).objectStore(store).getAll();
    r.onsuccess = () => res(r.result as T[]);
    r.onerror = () => rej(r.error);
  });
}

export async function getKv<T>(key: string): Promise<T | undefined> {
  const db = await open();
  return new Promise((res, rej) => {
    const r = db.transaction("kv").objectStore("kv").get(key);
    r.onsuccess = () => res(r.result as T | undefined);
    r.onerror = () => rej(r.error);
  });
}

export async function setKv(key: string, value: unknown): Promise<void> {
  const db = await open();
  const tx = db.transaction("kv", "readwrite");
  tx.objectStore("kv").put(value, key);
  return done(tx);
}

/** Одна запись: сохранить/удалить несколько объектов в разных хранилищах сразу. */
export interface Change { store: Exclude<StoreName, "kv">; put?: unknown[]; del?: string[] }
export async function apply(changes: Change[]): Promise<void> {
  if (!changes.length) return;
  const db = await open();
  const names = Array.from(new Set(changes.map((c) => c.store)));
  const tx = db.transaction(names, "readwrite");
  for (const c of changes) {
    const os = tx.objectStore(c.store);
    (c.put || []).forEach((v) => os.put(v));
    (c.del || []).forEach((k) => os.delete(k));
  }
  return done(tx);
}

/** Полная замена всех данных (восстановление из копии). */
export async function replaceAll(data: { products: unknown[]; log: unknown[]; recipes: unknown[]; kv: Record<string, unknown> }): Promise<void> {
  const db = await open();
  const tx = db.transaction(STORES as unknown as string[], "readwrite");
  for (const s of ["products", "log", "recipes"] as const) {
    const os = tx.objectStore(s);
    os.clear();
    data[s].forEach((v) => os.put(v));
  }
  const kv = tx.objectStore("kv");
  kv.clear();
  Object.entries(data.kv).forEach(([k, v]) => kv.put(v, k));
  return done(tx);
}

export async function allKv(): Promise<Record<string, unknown>> {
  const db = await open();
  return new Promise((res, rej) => {
    const out: Record<string, unknown> = {};
    const r = db.transaction("kv").objectStore("kv").openCursor();
    r.onsuccess = () => {
      const c = r.result;
      if (c) { out[String(c.key)] = c.value; c.continue(); } else res(out);
    };
    r.onerror = () => rej(r.error);
  });
}

/** Просим Safari не удалять данные приложения (работает, если приложение на экране «Домой»). */
export async function askPersist(): Promise<boolean | null> {
  try {
    if (!navigator.storage || !navigator.storage.persist) return null;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}
