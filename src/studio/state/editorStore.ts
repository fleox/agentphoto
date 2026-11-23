// The editor's document state (framework-free, tested): current document,
// selection, undo / redo stack of documents, live validation issues and
// persistence. Every edit is a list of PatchOps applied locally right away
// (applyPatchOps, so the viewport updates instantly) and sent to the project
// as one doc_patch after a short debounce; undo / redo and whole-document
// edits are sent as doc_apply. External changes (an agent editing photo.json
// from a terminal, the assistant, AI tools) come in through `external()` and
// are undoable.

import { deepEqual, stableStringify } from "../../core/jsonPath";
import type { Issue, PhotoDoc } from "../../core/types";
import { validateDoc } from "../../core/validate";
import { applyPatchOps, type PatchOp } from "../../ops/doc";
import type { SizeMap } from "../../ops/geometry";
import { findLayer } from "../../ops/tree";

export type PersistRequest = { kind: "patch"; ops: PatchOp[] } | { kind: "apply"; doc: PhotoDoc };

// Result of the mutating tools (src/ai/shared.ts mutationResult).
export interface MutationResult {
  status: "applied" | "refused" | "unchanged" | "dry-run";
  applied: boolean;
  plan?: { summary?: string };
  counts?: { errors: number; warnings: number; infos: number };
  issues?: Issue[];
  hint?: string;
}

export type Persist = (req: PersistRequest) => Promise<MutationResult>;

export type SaveState = { state: "saved" | "pending" | "saving" | "error"; message?: string; issues?: Issue[] };
export type ChangeSource = "load" | "edit" | "history" | "external" | "replace";

export interface EditorSnapshot {
  doc: PhotoDoc | null;
  // Selected layer ids; the last one is the primary selection (inspector).
  selection: string[];
  issues: Issue[];
  save: SaveState;
  canUndo: boolean;
  canRedo: boolean;
  revision: number;
  source: ChangeSource;
}

export interface EditorStoreOptions {
  debounceMs?: number;
  historyLimit?: number;
  coalesceMs?: number;
  now?: () => number;
  validate?: (doc: PhotoDoc) => Issue[];
  // Natural sizes of image sources (geometry ops: rotate / flip / resize the image).
  sizes?: () => SizeMap;
}

export const primaryOf = (sel: string[]): string | null => (sel.length ? sel[sel.length - 1] : null);

// Deep key structure of a merge patch ("x", "effects.dropShadow.blur").
function shape(v: unknown, prefix = ""): string[] {
  if (!v || typeof v !== "object" || Array.isArray(v)) return [prefix];
  return Object.keys(v as object)
    .sort()
    .flatMap((k) => shape((v as Record<string, unknown>)[k], prefix ? `${prefix}.${k}` : k));
}

// Two ops where the second fully overrides the first (drags, slider scrubs).
export function supersedes(prev: PatchOp, next: PatchOp): boolean {
  if (prev.op === "set" && next.op === "set") return prev.path === next.path;
  if (prev.op === "updateLayer" && next.op === "updateLayer") return prev.id === next.id && shape(prev.set).join() === shape(next.set).join() && !JSON.stringify(next.set).includes("null");
  if (prev.op === "updateFilter" && next.op === "updateFilter") return prev.id === next.id && prev.index === next.index && shape(prev.set).join() === shape(next.set).join();
  return false;
}

export class EditorStore {
  private snap: EditorSnapshot = { doc: null, selection: [], issues: [], save: { state: "saved" }, canUndo: false, canRedo: false, revision: 0, source: "load" };
  private listeners = new Set<() => void>();
  private past: PhotoDoc[] = [];
  private future: PhotoDoc[] = [];
  private pendingOps: PatchOp[] = [];
  private needsFull = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private chain: Promise<void> = Promise.resolve();
  private lastCoalesce: { key: string; at: number } | null = null;
  // Documents this store wrote (their file-change events are echoes, not external edits).
  private sent: string[] = [];
  private readonly opts: Required<Omit<EditorStoreOptions, "sizes">> & Pick<EditorStoreOptions, "sizes">;

  constructor(
    private persist: Persist,
    opts: EditorStoreOptions = {},
  ) {
    this.opts = { debounceMs: 300, historyLimit: 100, coalesceMs: 1000, now: () => Date.now(), validate: validateDoc, ...opts };
  }

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getSnapshot = (): EditorSnapshot => this.snap;

  get doc(): PhotoDoc | null {
    return this.snap.doc;
  }
  get primary(): string | null {
    return primaryOf(this.snap.selection);
  }

  private emit(patch: Partial<EditorSnapshot>): void {
    this.snap = { ...this.snap, ...patch, canUndo: this.past.length > 0, canRedo: this.future.length > 0 };
    this.listeners.forEach((l) => l());
  }

  private setDoc(doc: PhotoDoc, source: ChangeSource, extra: Partial<EditorSnapshot> = {}): void {
    const selection = (extra.selection ?? this.snap.selection).filter((id) => findLayer(doc.layers, id));
    this.emit({ doc, source, issues: this.opts.validate(doc), revision: this.snap.revision + 1, ...extra, selection });
  }

  private pushHistory(prev: PhotoDoc): void {
    this.past.push(prev);
    if (this.past.length > this.opts.historyLimit) this.past.shift();
    this.future = [];
  }

  load(doc: PhotoDoc): void {
    this.past = [];
    this.future = [];
    this.pendingOps = [];
    this.needsFull = false;
    this.lastCoalesce = null;
    this.setDoc(doc, "load", { save: { state: "saved" }, selection: [] });
  }

  select(ids: string | string[] | null): void {
    const next = ids === null ? [] : Array.isArray(ids) ? ids : [ids];
    if (next.join("\n") === this.snap.selection.join("\n")) return;
    this.emit({ selection: next });
  }

  // Shift / Cmd-click in the layers panel.
  toggleSelect(id: string): void {
    const s = this.snap.selection;
    this.select(s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);
  }

  // Applies ops locally and schedules persistence. Returns an error message
  // when an op can't apply (nothing changes then).
  edit(ops: PatchOp[], opts: { coalesce?: string; select?: string | string[] | null } = {}): string | null {
    const cur = this.snap.doc;
    if (!cur || !ops.length) return null;
    let next: PhotoDoc;
    try {
      next = applyPatchOps(cur, ops, this.opts.sizes?.() ?? {});
    } catch (e) {
      return (e as Error).message;
    }
    const now = this.opts.now();
    const coalesce = opts.coalesce && this.lastCoalesce?.key === opts.coalesce && now - this.lastCoalesce.at < this.opts.coalesceMs;
    if (!coalesce) this.pushHistory(cur);
    this.lastCoalesce = opts.coalesce ? { key: opts.coalesce, at: now } : null;
    for (const op of ops) this.queue(op);
    const select = opts.select === undefined ? undefined : opts.select === null ? [] : Array.isArray(opts.select) ? opts.select : [opts.select];
    this.setDoc(next, "edit", { save: { state: "pending" }, ...(select ? { selection: select } : {}) });
    this.schedule();
    return null;
  }

  // Drags produce many ops on the same target: keep only the last one.
  private queue(op: PatchOp): void {
    const last = this.pendingOps[this.pendingOps.length - 1];
    if (last && supersedes(last, op)) this.pendingOps[this.pendingOps.length - 1] = op;
    else this.pendingOps.push(op);
  }

  // Whole-document replacement (assistant undo): persisted with doc_apply.
  replace(doc: PhotoDoc): void {
    const cur = this.snap.doc;
    if (cur && deepEqual(cur, doc)) return;
    if (cur) this.pushHistory(cur);
    this.lastCoalesce = null;
    this.needsFull = true;
    this.pendingOps = [];
    this.setDoc(doc, "replace", { save: { state: "pending" } });
    this.schedule(0);
  }

  undo(): void {
    const prev = this.past.pop();
    if (!prev || !this.snap.doc) return;
    this.future.push(this.snap.doc);
    this.historyMove(prev);
  }

  redo(): void {
    const next = this.future.pop();
    if (!next || !this.snap.doc) return;
    this.past.push(this.snap.doc);
    this.historyMove(next);
  }

  private historyMove(doc: PhotoDoc): void {
    this.lastCoalesce = null;
    this.needsFull = true;
    this.pendingOps = [];
    this.setDoc(doc, "history", { save: { state: "pending" } });
    this.schedule(0);
  }

  // True when `doc` is a document this store saved itself (file-change echo).
  isEcho(doc: PhotoDoc): boolean {
    return this.sent.includes(stableStringify(doc));
  }

  // photo.json changed on disk (an agent, a tool). Local edits not sent yet
  // are replayed on top when they still apply. Returns false when nothing changed.
  external(doc: PhotoDoc): boolean {
    const cur = this.snap.doc;
    if (cur && deepEqual(cur, doc)) return false;
    let next = doc;
    if (this.pendingOps.length && !this.needsFull) {
      try {
        next = applyPatchOps(doc, this.pendingOps, this.opts.sizes?.() ?? {});
      } catch {
        this.pendingOps = [];
      }
    } else {
      this.pendingOps = [];
      this.needsFull = false;
    }
    if (cur && deepEqual(cur, next)) return false;
    if (cur) this.pushHistory(cur);
    this.lastCoalesce = null;
    this.setDoc(next, "external", { save: this.pendingOps.length ? this.snap.save : { state: "saved" } });
    return true;
  }

  private schedule(ms = this.opts.debounceMs): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, ms);
  }

  get dirty(): boolean {
    return this.needsFull || this.pendingOps.length > 0;
  }

  // Sends pending changes now (serialised: one request at a time).
  flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.chain = this.chain.then(() => this.sendOnce());
    return this.chain;
  }

  private async sendOnce(): Promise<void> {
    const doc = this.snap.doc;
    if (!doc || !this.dirty) return;
    const req: PersistRequest = this.needsFull ? { kind: "apply", doc } : { kind: "patch", ops: this.pendingOps };
    this.pendingOps = [];
    this.needsFull = false;
    this.sent = [...this.sent.slice(-7), stableStringify(doc)];
    this.emit({ save: { state: "saving" } });
    try {
      const r = await this.persist(req);
      if (r.status === "refused") {
        // Keep the local state; the next save sends the whole document.
        this.needsFull = true;
        const errors = (r.issues ?? []).filter((i) => i.severity === "error");
        this.emit({ save: { state: "error", message: errors[0]?.message ?? r.hint, issues: errors } });
      } else if (!this.dirty) this.emit({ save: { state: "saved" } });
      else this.emit({ save: { state: "pending" } });
    } catch (e) {
      this.needsFull = true;
      this.emit({ save: { state: "error", message: (e as Error).message } });
    }
  }
}
