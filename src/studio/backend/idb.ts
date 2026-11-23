// In-browser projects: a MemoryFs per project, persisted to IndexedDB
// (one record per project: { id, title, updatedAt, thumb, files }).

import { MemoryFs } from "../../core/fs";
import type { ProjectRef } from "./types";

const DB = "agentphoto-studio";
const STORE = "projects";

export interface StoredProject extends ProjectRef {
  files: Record<string, Uint8Array>;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;
function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (!dbPromise)
    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  return dbPromise;
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  const db = await openDb();
  if (!db) return undefined;
  return new Promise((resolve) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(undefined);
  });
}

export const projectsDb = {
  async list(): Promise<ProjectRef[]> {
    const all = ((await tx("readonly", (s) => s.getAll())) ?? []) as StoredProject[];
    return all.map(({ id, title, updatedAt, thumb }) => ({ id, title, updatedAt, thumb })).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  },
  async get(id: string): Promise<StoredProject | undefined> {
    return (await tx("readonly", (s) => s.get(id))) as StoredProject | undefined;
  },
  async put(p: StoredProject): Promise<void> {
    await tx("readwrite", (s) => s.put(p));
  },
  async remove(id: string): Promise<void> {
    await tx("readwrite", (s) => s.delete(id));
  },
};

// MemoryFs that saves itself (debounced) after every write and tells
// listeners which files changed.
export class PersistedFs extends MemoryFs {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private changed = new Set<string>();
  private notifyTimer: ReturnType<typeof setTimeout> | null = null;
  readonly listeners = new Set<(paths: string[]) => void>();

  constructor(
    readonly id: string,
    initial: Record<string, Uint8Array>,
    private meta: () => Omit<ProjectRef, "id">,
    private delay = 400,
  ) {
    super(initial);
  }
  private touched(path: string): void {
    this.changed.add(path);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.save(), this.delay);
    if (!this.notifyTimer)
      this.notifyTimer = setTimeout(() => {
        this.notifyTimer = null;
        const paths = [...this.changed];
        this.changed.clear();
        this.listeners.forEach((l) => l(paths));
      }, 30);
  }
  async save(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await projectsDb.put({ id: this.id, ...this.meta(), updatedAt: new Date().toISOString(), files: Object.fromEntries(this.files) });
  }
  override async writeText(path: string, text: string): Promise<void> {
    await super.writeText(path, text);
    this.touched(path);
  }
  override async writeBytes(path: string, bytes: Uint8Array): Promise<void> {
    await super.writeBytes(path, bytes);
    this.touched(path);
  }
  override async remove(path: string): Promise<void> {
    await super.remove(path);
    this.touched(path);
  }
}
