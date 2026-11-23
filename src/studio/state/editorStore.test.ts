import { describe, expect, it, vi } from "vitest";
import type { PhotoDoc } from "../../core/types";
import { EditorStore, supersedes, type PersistRequest } from "./editorStore";

const doc = (): PhotoDoc => ({
  version: 1,
  id: "t",
  canvas: { width: 100, height: 80 },
  layers: [
    { id: "photo", type: "shape", shape: "rect", x: 0, y: 0, width: 100, height: 80, fill: "#000" },
    { id: "title", type: "text", text: "Hi", x: 10, y: 10 },
  ],
});

function setup(opts: { now?: () => number } = {}) {
  const sent: PersistRequest[] = [];
  const store = new EditorStore(
    async (req) => {
      sent.push(req);
      return { status: "applied", applied: true };
    },
    { debounceMs: 10_000, validate: () => [], ...opts },
  );
  store.load(doc());
  return { store, sent };
}

describe("EditorStore", () => {
  it("applies edits locally, undoes and redoes them", () => {
    const { store } = setup();
    expect(store.edit([{ op: "updateLayer", id: "title", set: { x: 50 } }])).toBeNull();
    expect((store.doc!.layers[1] as { x: number }).x).toBe(50);
    expect(store.getSnapshot().canUndo).toBe(true);
    store.undo();
    expect((store.doc!.layers[1] as { x: number }).x).toBe(10);
    store.redo();
    expect((store.doc!.layers[1] as { x: number }).x).toBe(50);
  });

  it("coalesces a drag into one undo step and one persisted op", async () => {
    let t = 0;
    const { store, sent } = setup({ now: () => t });
    for (let x = 11; x <= 20; x++) {
      t += 16;
      store.edit([{ op: "updateLayer", id: "title", set: { x } }], { coalesce: "drag" });
    }
    await store.flush();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({ kind: "patch", ops: [{ op: "updateLayer", id: "title", set: { x: 20 } }] });
    store.undo();
    expect((store.doc!.layers[1] as { x: number }).x).toBe(10);
    expect(store.getSnapshot().canUndo).toBe(false);
  });

  it("reports ops that cannot apply without changing anything", () => {
    const { store } = setup();
    const before = store.doc;
    expect(store.edit([{ op: "removeLayer", id: "nope" }])).toMatch(/nope/);
    expect(store.doc).toBe(before);
    expect(store.getSnapshot().canUndo).toBe(false);
  });

  it("persists undo / redo as a whole-document apply", async () => {
    const { store, sent } = setup();
    store.edit([{ op: "removeLayer", id: "title" }]);
    store.undo();
    await store.flush();
    expect(sent.at(-1)?.kind).toBe("apply");
    expect((sent.at(-1) as { doc: PhotoDoc }).doc.layers).toHaveLength(2);
  });

  it("keeps the selection on existing layers and drops removed ones", () => {
    const { store } = setup();
    store.select(["photo", "title"]);
    expect(store.primary).toBe("title");
    store.edit([{ op: "removeLayer", id: "title" }]);
    expect(store.getSnapshot().selection).toEqual(["photo"]);
    store.toggleSelect("photo");
    expect(store.getSnapshot().selection).toEqual([]);
  });

  it("takes external changes (undoable), replays unsent edits and ignores its own echoes", async () => {
    const { store } = setup();
    store.edit([{ op: "updateLayer", id: "title", set: { text: "Local" } }]);
    const ext = doc();
    ext.layers.push({ id: "badge", type: "shape", shape: "ellipse", x: 1, y: 1, width: 5, height: 5 });
    expect(store.external(ext)).toBe(true);
    expect(store.doc!.layers.map((l) => l.id)).toEqual(["photo", "title", "badge"]);
    expect((store.doc!.layers[1] as { text: string }).text).toBe("Local");
    await store.flush();
    expect(store.isEcho(store.doc!)).toBe(true);
    expect(store.external(store.doc!)).toBe(false);
    store.undo();
    expect(store.doc!.layers).toHaveLength(2);
  });

  it("marks refused saves as errors and resends the whole document next time", async () => {
    const persist = vi.fn(async (req: PersistRequest) => (req.kind === "patch" ? { status: "refused" as const, applied: false, issues: [{ severity: "error" as const, code: "x", path: "layers", message: "Bad" }] } : { status: "applied" as const, applied: true }));
    const store = new EditorStore(persist, { debounceMs: 10_000, validate: () => [] });
    store.load(doc());
    store.edit([{ op: "updateLayer", id: "title", set: { x: 1 } }]);
    await store.flush();
    expect(store.getSnapshot().save).toMatchObject({ state: "error", message: "Bad" });
    store.edit([{ op: "updateLayer", id: "title", set: { x: 2 } }]);
    await store.flush();
    expect(persist.mock.calls.at(-1)?.[0].kind).toBe("apply");
    expect(store.getSnapshot().save.state).toBe("saved");
  });

  it("supersedes only same-target, same-shape ops", () => {
    expect(supersedes({ op: "set", path: "canvas.background", value: "#000" }, { op: "set", path: "canvas.background", value: "#fff" })).toBe(true);
    expect(supersedes({ op: "updateLayer", id: "a", set: { x: 1, y: 2 } }, { op: "updateLayer", id: "a", set: { x: 3, y: 4 } })).toBe(true);
    expect(supersedes({ op: "updateLayer", id: "a", set: { x: 1 } }, { op: "updateLayer", id: "a", set: { y: 4 } })).toBe(false);
    expect(supersedes({ op: "updateLayer", id: "a", set: { x: 1 } }, { op: "updateLayer", id: "b", set: { x: 4 } })).toBe(false);
    expect(supersedes({ op: "updateLayer", id: "a", set: { effects: { dropShadow: { blur: 1 } } } }, { op: "updateLayer", id: "a", set: { effects: { dropShadow: { blur: 9 } } } })).toBe(true);
    expect(supersedes({ op: "updateLayer", id: "a", set: { mask: { x: 1 } } }, { op: "updateLayer", id: "a", set: { mask: null } })).toBe(false);
    expect(supersedes({ op: "updateFilter", id: "a", index: 0, set: { radius: 1 } }, { op: "updateFilter", id: "a", index: 0, set: { radius: 5 } })).toBe(true);
    expect(supersedes({ op: "updateFilter", id: "a", index: 0, set: { radius: 1 } }, { op: "updateFilter", id: "a", index: 1, set: { radius: 5 } })).toBe(false);
  });
});
