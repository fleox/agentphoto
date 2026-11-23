import { useSyncExternalStore } from "react";

// Minimal external store for UI state shared across panels.
export interface TinyStore<T> {
  get(): T;
  set(patch: Partial<T> | ((s: T) => Partial<T>)): void;
  subscribe(l: () => void): () => void;
}

export function createStore<T extends object>(initial: T): TinyStore<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(patch) {
      const p = typeof patch === "function" ? patch(state) : patch;
      state = { ...state, ...p };
      listeners.forEach((l) => l());
    },
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

export function useStore<T extends object, U>(store: TinyStore<T>, select: (s: T) => U): U {
  return useSyncExternalStore(store.subscribe, () => select(store.get()));
}
