// The document: read, summarise, diff, replace (applyDoc) and patch (patchDoc).
// Every write validates first: a document with errors is never saved.

import type { ProjectFs } from "../core/fs";
import { isValidId, uniqueId } from "../core/ids";
import { clone, deepEqual, getAt, mergePatch, PathError, removeAt, setAt } from "../core/jsonPath";
import { isLibraryRef } from "../core/library";
import { didYouMean } from "../core/suggest";
import { hasBox, type Filter, type Issue, type Layer, type Mask, type PhotoDoc } from "../core/types";
import { normalizeDoc, validateDoc } from "../core/validate";
import { hasErrors, OpsError, readJson } from "./context";
import { ANCHORS, cropDoc, flipDoc, resizeCanvasDoc, rotateDoc, scaleDoc, type Anchor, type SizeMap } from "./geometry";

import { allLayerIds, findLayer, flattenLayers, isDescendant, layerDetail, maskKind, walkLayers, type FlatLayer } from "./tree";

import { DOC_FILE, saveDoc } from "./project";
export { DOC_FILE };

export async function getDoc(fs: ProjectFs): Promise<PhotoDoc> {
  return normalizeDoc(await readJson<PhotoDoc>(fs, DOC_FILE, "The document"));
}

// ─── summary ────────────────────────────────────────────────────────────

export interface LayerSummary {
  id: string;
  type: Layer["type"];
  name?: string;
  detail: string;
  box?: [number, number, number | null, number | null];
  rotation?: number;
  opacity?: number;
  blend?: string;
  hidden?: true;
  clip?: true;
  mask?: string;
  filters?: string[];
  effects?: string[];
  children?: LayerSummary[];
}

export interface DocSummary {
  id: string;
  title?: string;
  canvas: { width: number; height: number; background: string };
  // Top → bottom, like a layers panel.
  layers: LayerSummary[];
  counts: { layers: number; byType: Record<string, number>; hidden: number; masks: number; filters: number };
  sources: string[];
  export?: PhotoDoc["export"];
}

function summarizeLayer(l: Layer, f: FlatLayer): LayerSummary {
  const { parent: _p, depth: _d, index: _i, locked: _l, ...rest } = f;
  const out: LayerSummary = { ...rest };
  if (l.type === "group") out.children = [...(l.children ?? [])].reverse().map((c, k, arr) => summarizeLayer(c, flatOf(c, l, arr.length - 1 - k)));
  return out;
}

const flatOf = (l: Layer, parent: Layer | null, index: number): FlatLayer => {
  const f = flattenLayers({ layers: [l] })[0];
  return { ...f, parent: parent?.id ?? null, index };
};

export function summarizeDoc(doc: PhotoDoc): DocSummary {
  const byType: Record<string, number> = {};
  let hidden = 0;
  let masks = 0;
  let filters = 0;
  const sources = new Set<string>();
  walkLayers(doc.layers, (l) => {
    byType[l.type] = (byType[l.type] ?? 0) + 1;
    if (l.visible === false) hidden++;
    if (l.mask) masks++;
    filters += l.filters?.length ?? 0;
    if (l.type === "image") sources.add(l.src);
    if (l.mask && "src" in l.mask) sources.add(l.mask.src);
  });
  const bg = doc.canvas?.background;
  return {
    id: doc.id,
    ...(doc.title ? { title: doc.title } : {}),
    canvas: { width: doc.canvas?.width, height: doc.canvas?.height, background: bg === undefined || bg === null ? "transparent" : typeof bg === "string" ? bg : `${bg.type} gradient` },
    layers: [...(doc.layers ?? [])].reverse().map((l, k, arr) => summarizeLayer(l, flatOf(l, null, arr.length - 1 - k))),
    counts: { layers: Object.values(byType).reduce((a, b) => a + b, 0), byType, hidden, masks, filters },
    sources: [...sources],
    ...(doc.export ? { export: doc.export } : {}),
  };
}

// ─── diff ───────────────────────────────────────────────────────────────

export interface DocPlan {
  empty: boolean;
  layers: { added: string[]; removed: string[]; changed: { id: string; fields: string[] }[]; moved: { id: string; from: string; to: string }[] };
  sections: string[];
  summary: string;
}

export function diffDocs(before: PhotoDoc | null, after: PhotoDoc): DocPlan {
  const map = (d: PhotoDoc | null) => {
    const m = new Map<string, { layer: Layer; where: string }>();
    if (!d) return m;
    const visit = (layers: Layer[], parent: string) =>
      layers.forEach((l, i) => {
        if (!l || typeof l !== "object") return;
        m.set(l.id, { layer: l, where: `${parent}[${i}]` });
        if (l.type === "group") visit(l.children ?? [], l.id);
      });
    visit(d.layers ?? [], "root");
    return m;
  };
  const a = map(before);
  const b = map(after);
  const added = [...b.keys()].filter((id) => !a.has(id));
  const removed = [...a.keys()].filter((id) => !b.has(id));
  const changed: { id: string; fields: string[] }[] = [];
  const moved: { id: string; from: string; to: string }[] = [];
  for (const [id, { layer, where }] of b) {
    const old = a.get(id);
    if (!old) continue;
    const keys = new Set([...Object.keys(old.layer), ...Object.keys(layer)]);
    keys.delete("children");
    const fields = [...keys].filter((k) => !deepEqual((old.layer as unknown as Record<string, unknown>)[k], (layer as unknown as Record<string, unknown>)[k]));
    if (fields.length) changed.push({ id, fields });
    if (old.where !== where) moved.push({ id, from: old.where, to: where });
  }
  // Pure index shifts caused by adds / removes are not moves.
  const realMoves = moved.filter((m) => m.from.split("[")[0] !== m.to.split("[")[0] || (!added.length && !removed.length));
  const sections = (["canvas", "title", "description", "export", "id", "version"] as const).filter((k) => !deepEqual(before?.[k], after[k]));
  const parts: string[] = [];
  if (added.length) parts.push(`added ${added.join(", ")}`);
  if (removed.length) parts.push(`removed ${removed.join(", ")}`);
  if (changed.length) parts.push(`changed ${changed.map((c) => `${c.id} (${c.fields.join(", ")})`).join("; ")}`);
  if (realMoves.length) parts.push(`moved ${realMoves.map((m) => m.id).join(", ")}`);
  if (sections.length) parts.push(`updated ${sections.join(", ")}`);
  const empty = !parts.length;
  return { empty, layers: { added, removed, changed, moved: realMoves }, sections, summary: empty ? "No change." : `${parts.join("; ")}.` };
}

// ─── apply (full replace) ───────────────────────────────────────────────

export interface WriteResult {
  plan: DocPlan;
  issues: Issue[];
  applied: boolean;
}

export async function applyDoc(fs: ProjectFs, next: PhotoDoc, opts: { dryRun?: boolean } = {}): Promise<WriteResult> {
  const before = (await fs.exists(DOC_FILE)) ? await getDoc(fs).catch(() => null) : null;
  const doc = normalizeDoc(next);
  const issues = validateDoc(doc);
  const plan = diffDocs(before, doc);
  if (hasErrors(issues) || opts.dryRun || plan.empty) return { plan, issues, applied: false };
  await saveDoc(fs, doc, { allowInvalid: false });
  return { plan, issues, applied: true };
}

// ─── patch ──────────────────────────────────────────────────────────────

export type Position = { parent?: string | null; index?: number; above?: string; below?: string };

export type PatchOp =
  | { op: "set"; path: string; value: unknown }
  | { op: "merge"; path: string; value: unknown }
  | { op: "remove"; path: string }
  | ({ op: "addLayer"; layer: Layer } & Position)
  | { op: "updateLayer"; id: string; set: Record<string, unknown> }
  | { op: "removeLayer"; id: string }
  | ({ op: "moveLayer"; id: string } & Position)
  | { op: "duplicateLayer"; id: string; newId?: string; offset?: [number, number] }
  | { op: "groupLayers"; ids: string[]; id: string; name?: string }
  | { op: "ungroup"; id: string }
  | { op: "addFilter"; id: string; filter: Filter; index?: number }
  | { op: "updateFilter"; id: string; index: number; set: Record<string, unknown> }
  | { op: "removeFilter"; id: string; index: number }
  | { op: "setMask"; id: string; mask: Mask | null }
  | { op: "crop"; x: number; y: number; width: number; height: number }
  | { op: "resizeCanvas"; width: number; height: number; anchor?: Anchor }
  | { op: "resizeImage"; width?: number; height?: number; scale?: number }
  | { op: "rotateCanvas"; angle: number }
  | { op: "flipCanvas"; axis: "horizontal" | "vertical" };

export const PATCH_OPS = ["set", "merge", "remove", "addLayer", "updateLayer", "removeLayer", "moveLayer", "duplicateLayer", "groupLayers", "ungroup", "addFilter", "updateFilter", "removeFilter", "setMask", "crop", "resizeCanvas", "resizeImage", "rotateCanvas", "flipCanvas"] as const;

// Ops that need the natural size of image sources (geometry).
export const GEOMETRY_OPS = new Set(["resizeImage", "rotateCanvas", "flipCanvas"]);

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function opError(i: number, code: "invalid" | "conflict" | "notFound", message: string, hint?: string): OpsError {
  return new OpsError(code === "notFound" ? "notFound" : code, `ops[${i}]: ${message}`, hint, { opIndex: i });
}

function need(doc: PhotoDoc, id: unknown, i: number) {
  if (typeof id !== "string") throw opError(i, "invalid", '"id" (a layer id) is required.');
  const loc = findLayer(doc.layers, id);
  if (!loc) throw opError(i, "notFound", `No layer "${id}".`, `${didYouMean(id, allLayerIds(doc))}doc_summary / layer_list list the layer ids.`);
  return loc;
}

// Where to insert: { parent, index } or { above / below: id }. Default: top of the root.
function target(doc: PhotoDoc, pos: Position, i: number, moving?: Layer): { container: Layer[]; index: number } {
  const ref = pos.above ?? pos.below;
  if (ref !== undefined) {
    const loc = need(doc, ref, i);
    if (moving && (loc.layer === moving || isDescendant(moving, ref))) throw opError(i, "invalid", `Cannot place "${moving.id}" relative to itself or its own child.`);
    return { container: loc.container, index: pos.above !== undefined ? loc.index + 1 : loc.index };
  }
  let container = doc.layers;
  if (pos.parent !== undefined && pos.parent !== null) {
    const loc = need(doc, pos.parent, i);
    if (loc.layer.type !== "group") throw opError(i, "invalid", `"${pos.parent}" is a ${loc.layer.type} layer, not a group.`, "Only group layers have children (groupLayers creates one).");
    if (moving && (loc.layer === moving || isDescendant(moving, loc.layer.id))) throw opError(i, "invalid", `Cannot move "${moving.id}" into itself.`);
    container = loc.layer.children ??= [];
  }
  const index = pos.index === undefined ? container.length : Math.max(0, Math.min(container.length, Math.round(pos.index)));
  return { container, index };
}

function checkNewIds(doc: PhotoDoc, layer: Layer, i: number) {
  const taken = new Set(allLayerIds(doc));
  const visit = (l: Layer) => {
    if (!isObj(l)) throw opError(i, "invalid", "layer must be an object.");
    if (!isValidId(l.id)) throw opError(i, "invalid", `Invalid layer id ${JSON.stringify(l.id)}.`, 'Ids start with a letter: "photo", "title", "badge-2".');
    if (taken.has(l.id)) throw opError(i, "conflict", `A layer "${l.id}" already exists.`, `Use updateLayer to change it, or another id (e.g. "${uniqueId(l.id, taken)}").`);
    taken.add(l.id);
    if (l.type === "group") (l.children ?? []).forEach(visit);
  };
  visit(layer);
}

function renameTree(l: Layer, taken: Set<string>, rootId?: string): Layer {
  const copy = clone(l);
  const visit = (x: Layer, isRoot: boolean) => {
    x.id = isRoot && rootId ? rootId : uniqueId(`${x.id}-copy`, taken);
    taken.add(x.id);
    if (x.type === "group") (x.children ?? []).forEach((c) => visit(c, false));
  };
  visit(copy, true);
  return copy;
}

function filtersOf(loc: { layer: Layer }, i: number): Filter[] {
  const l = loc.layer as Layer & { filters?: Filter[] };
  if (!Array.isArray(l.filters)) l.filters = [];
  void i;
  return l.filters;
}

function filterIndex(list: Filter[], index: unknown, i: number, id: string): number {
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= list.length) throw opError(i, "invalid", `Layer "${id}" has no filter at index ${JSON.stringify(index)} (it has ${list.length}).`, "layer_list / doc_summary list each layer's filters in order.");
  return index;
}

// Applies ops in order on a copy; throws OpsError("invalid" | "conflict" | "notFound") with details.opIndex.
export function applyPatchOps(doc: PhotoDoc, ops: PatchOp[], sizes: SizeMap = {}): PhotoDoc {
  if (!Array.isArray(ops)) throw new OpsError("invalid", "ops must be an array of patch operations.");
  let d = clone(doc);
  ops.forEach((op, i) => {
    if (!isObj(op) || typeof op.op !== "string") throw opError(i, "invalid", 'Each op is an object with an "op" field.', `Ops: ${PATCH_OPS.join(", ")}.`);
    try {
      switch (op.op) {
        case "set":
          if (typeof op.path !== "string") throw opError(i, "invalid", '"path" is required.');
          setAt(d, op.path, clone(op.value));
          break;
        case "merge": {
          if (typeof op.path !== "string") throw opError(i, "invalid", '"path" is required.');
          let cur: unknown;
          try {
            cur = getAt(d, op.path);
          } catch {
            cur = undefined;
          }
          setAt(d, op.path, mergePatch(cur, op.value));
          break;
        }
        case "remove":
          if (typeof op.path !== "string") throw opError(i, "invalid", '"path" is required.');
          if (!removeAt(d, op.path)) throw opError(i, "notFound", `Nothing at "${op.path}".`);
          break;
        case "addLayer": {
          if (!isObj(op.layer)) throw opError(i, "invalid", '"layer" (a layer object) is required.');
          checkNewIds(d, op.layer, i);
          const t = target(d, op, i);
          t.container.splice(t.index, 0, clone(op.layer));
          break;
        }
        case "updateLayer": {
          const loc = need(d, op.id, i);
          if (!isObj(op.set)) throw opError(i, "invalid", '"set" (an object of fields to change) is required.');
          for (const k of ["id", "type", "children"]) if (k in op.set) throw opError(i, "invalid", `updateLayer cannot change "${k}".`, k === "children" ? "Use addLayer / moveLayer with parent." : "Remove the layer and add a new one.");
          const next = mergePatch(loc.layer, op.set) as Layer;
          loc.container[loc.index] = next;
          break;
        }
        case "removeLayer": {
          const loc = need(d, op.id, i);
          loc.container.splice(loc.index, 1);
          break;
        }
        case "moveLayer": {
          const loc = need(d, op.id, i);
          const layer = loc.layer;
          const t0 = target(d, op, i, layer);
          loc.container.splice(loc.index, 1);
          // Removing shifted indexes in the same container.
          const t = target(d, op, i, layer);
          void t0;
          t.container.splice(t.index, 0, layer);
          break;
        }
        case "duplicateLayer": {
          const loc = need(d, op.id, i);
          const taken = new Set(allLayerIds(d));
          if (op.newId !== undefined && (!isValidId(op.newId) || taken.has(op.newId))) throw opError(i, "conflict", `newId ${JSON.stringify(op.newId)} is invalid or taken.`);
          const copy = renameTree(loc.layer, taken, op.newId);
          if (op.offset && hasBox(copy)) {
            copy.x = (copy.x ?? 0) + op.offset[0];
            copy.y = (copy.y ?? 0) + op.offset[1];
          }
          if (copy.name) copy.name = `${copy.name} copy`;
          loc.container.splice(loc.index + 1, 0, copy);
          break;
        }
        case "groupLayers": {
          if (!Array.isArray(op.ids) || !op.ids.length) throw opError(i, "invalid", '"ids" (layers to group) is required.');
          if (!isValidId(op.id) || allLayerIds(d).includes(op.id)) throw opError(i, "conflict", `Group id ${JSON.stringify(op.id)} is invalid or taken.`);
          const locs = op.ids.map((id) => need(d, id, i));
          const container = locs[0].container;
          if (locs.some((l) => l.container !== container)) throw opError(i, "invalid", "Grouped layers must be siblings (same parent).");
          const sorted = [...locs].sort((a, b) => a.index - b.index);
          const at = sorted[0].index;
          const children = sorted.map((l) => l.layer);
          for (const l of [...sorted].reverse()) container.splice(l.index, 1);
          container.splice(at, 0, { id: op.id, type: "group", ...(op.name ? { name: op.name } : {}), children });
          break;
        }
        case "ungroup": {
          const loc = need(d, op.id, i);
          if (loc.layer.type !== "group") throw opError(i, "invalid", `"${op.id}" is not a group.`);
          loc.container.splice(loc.index, 1, ...(loc.layer.children ?? []));
          break;
        }
        case "addFilter": {
          const loc = need(d, op.id, i);
          if (!isObj(op.filter) || typeof op.filter.type !== "string") throw opError(i, "invalid", '"filter" ({ type, ...params }) is required.', 'e.g. { "type": "brightnessContrast", "contrast": 20 } — catalog_get section "filters".');
          const list = filtersOf(loc, i);
          const at = op.index === undefined ? list.length : Math.max(0, Math.min(list.length, op.index));
          list.splice(at, 0, clone(op.filter));
          break;
        }
        case "updateFilter": {
          const loc = need(d, op.id, i);
          const list = filtersOf(loc, i);
          const k = filterIndex(list, op.index, i, op.id);
          if (!isObj(op.set)) throw opError(i, "invalid", '"set" is required.');
          list[k] = mergePatch(list[k], op.set) as Filter;
          break;
        }
        case "removeFilter": {
          const loc = need(d, op.id, i);
          const list = filtersOf(loc, i);
          list.splice(filterIndex(list, op.index, i, op.id), 1);
          break;
        }
        case "setMask": {
          const loc = need(d, op.id, i);
          if (op.mask === null || op.mask === undefined) delete loc.layer.mask;
          else loc.layer.mask = clone(op.mask);
          break;
        }
        case "crop":
          d = cropDoc(d, op);
          break;
        case "resizeCanvas":
          if (op.anchor !== undefined && !ANCHORS.includes(op.anchor)) throw opError(i, "invalid", `Unknown anchor "${op.anchor}".`, `Anchors: ${ANCHORS.join(", ")}.`);
          if (!(op.width >= 1) || !(op.height >= 1)) throw opError(i, "invalid", "resizeCanvas needs width ≥ 1 and height ≥ 1.");
          d = resizeCanvasDoc(d, Math.round(op.width), Math.round(op.height), op.anchor);
          break;
        case "resizeImage": {
          const W = d.canvas.width;
          const H = d.canvas.height;
          let sx: number;
          let sy: number;
          if (typeof op.scale === "number") sx = sy = op.scale;
          else if (typeof op.width === "number" && typeof op.height === "number") [sx, sy] = [op.width / W, op.height / H];
          else if (typeof op.width === "number") sx = sy = op.width / W;
          else if (typeof op.height === "number") sx = sy = op.height / H;
          else throw opError(i, "invalid", "resizeImage needs scale, width and/or height.");
          d = scaleDoc(d, sx, sy, sizes);
          break;
        }
        case "rotateCanvas":
          d = rotateDoc(d, op.angle, sizes);
          break;
        case "flipCanvas":
          d = flipDoc(d, op.axis, sizes);
          break;
        default:
          throw opError(i, "invalid", `Unknown op "${(op as { op: string }).op}".`, `${didYouMean((op as { op: string }).op, PATCH_OPS)}Ops: ${PATCH_OPS.join(", ")}.`);
      }
    } catch (e) {
      if (e instanceof OpsError) {
        if ((e.details as { opIndex?: number } | undefined)?.opIndex !== undefined) throw e;
        throw new OpsError(e.code, `ops[${i}] (${op.op}): ${e.message}`, e.hint, { opIndex: i });
      }
      if (e instanceof PathError) throw new OpsError("invalid", `ops[${i}] (${op.op}): ${e.message}`, e.hint ?? 'Paths look like "canvas.background", "layers#title.size", "layers#photo.filters[0].radius".', { opIndex: i });
      throw e;
    }
  });
  return d;
}

// Natural sizes of the image sources the given ops need (geometry ops).
export async function sourceSizes(fs: ProjectFs, doc: PhotoDoc, readLibrary?: (id: string) => Promise<Uint8Array | null>): Promise<SizeMap> {
  const { imageInfo } = await import("../core/imageInfo");
  const out: SizeMap = {};
  const srcs = new Set<string>();
  walkLayers(doc.layers, (l) => {
    if (l.type === "image") srcs.add(l.src);
  });
  for (const src of srcs) {
    try {
      const bytes = isLibraryRef(src) ? (readLibrary ? await readLibrary(src.slice(8)) : null) : await fs.readBytes(src);
      const info = bytes ? imageInfo(bytes) : null;
      if (info) out[src] = { width: info.width, height: info.height };
    } catch {
      /* unknown size: geometry ops will ask for an explicit one */
    }
  }
  return out;
}

export interface PatchResult extends WriteResult {
  doc: PhotoDoc;
}

export async function patchDoc(fs: ProjectFs, ops: PatchOp[], opts: { dryRun?: boolean; sizes?: SizeMap; readLibrary?: (id: string) => Promise<Uint8Array | null> } = {}): Promise<PatchResult> {
  const before = await getDoc(fs);
  const sizes = opts.sizes ?? (Array.isArray(ops) && ops.some((o) => isObj(o) && GEOMETRY_OPS.has(o.op as string)) ? await sourceSizes(fs, before, opts.readLibrary) : {});
  const doc = applyPatchOps(before, ops, sizes);
  const issues = validateDoc(doc);
  const plan = diffDocs(before, doc);
  if (hasErrors(issues) || opts.dryRun || plan.empty) return { plan, issues, applied: false, doc: hasErrors(issues) ? before : doc };
  await saveDoc(fs, doc);
  return { plan, issues, applied: true, doc };
}

// ─── layer listing (layer_list) ─────────────────────────────────────────

export { flattenLayers, findLayer, layerDetail, maskKind };
