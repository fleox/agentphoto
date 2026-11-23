// JSON paths into a photo document, as agents write them:
//
//   canvas.width                    plain keys
//   layers[0].opacity               array indexes
//   layers#title.color              an element by id — for "layers" (and
//                                   "children") the id is searched in the whole
//                                   layer tree (groups); for other arrays
//                                   ("filters", "stops") use indexes
//   layers#title.filters[0].amount  index into a list
//
// Pure functions over plain JSON values (no DOM, no Node).

export type PathToken = { key: string } | { index: number } | { ref: string; tree: boolean };

export class PathError extends Error {
  override name = "PathError";
  constructor(
    message: string,
    readonly hint?: string,
  ) {
    super(message);
  }
}

const SEGMENT_RE = /^([^#[\]]*)(?:#([^[\]]+))?((?:\[\d+\])*)$/;

export function parsePath(path: string): PathToken[] {
  if (typeof path !== "string" || !path.trim()) throw new PathError("Empty path.", 'Use a path like "canvas.width" or "layers#title.color".');
  const tokens: PathToken[] = [];
  for (const seg of splitSegments(path.trim())) {
    const m = SEGMENT_RE.exec(seg);
    if (!m) throw new PathError(`Invalid path segment "${seg}" in "${path}".`, 'Segments are keys, "[index]" or "key#id", e.g. "layers#group.children[0].x".');
    const [, key, ref, idx] = m;
    if (key) tokens.push({ key });
    else if (!ref && !idx) throw new PathError(`Empty segment in "${path}".`);
    if (ref) tokens.push({ ref, tree: key === "layers" || key === "children" });
    for (const im of idx.matchAll(/\[(\d+)\]/g)) tokens.push({ index: Number(im[1]) });
  }
  return tokens;
}

// Splits on dots that are not inside an "#id" (ids cannot contain dots anyway).
function splitSegments(path: string): string[] {
  return path.split(".");
}

export function formatPath(tokens: PathToken[]): string {
  let out = "";
  for (const t of tokens) {
    if ("key" in t) out += out ? `.${t.key}` : t.key;
    else if ("index" in t) out += `[${t.index}]`;
    else out += `#${t.ref}`;
  }
  return out;
}

type Json = unknown;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

// Finds an element with `id` in an array; `tree` also descends into `children`.
export function findById(arr: unknown[], id: string, tree: boolean): { container: unknown[]; index: number } | null {
  for (let i = 0; i < arr.length; i++) {
    const el = arr[i];
    if (isObj(el) && el.id === id) return { container: arr, index: i };
  }
  if (tree) {
    for (const el of arr) {
      if (isObj(el) && Array.isArray(el.children)) {
        const found = findById(el.children, id, true);
        if (found) return found;
      }
    }
  }
  return null;
}

interface Location {
  parent: Record<string, unknown> | unknown[];
  key: string | number;
}

// Resolves every token but the last to a container; returns where the last token points.
function locate(root: Json, tokens: PathToken[], create: boolean, fullPath: string): Location {
  if (!tokens.length) throw new PathError("Empty path.");
  let cur: Json = root;
  // A `ref` token applies to the array the previous key produced; we merge
  // "key" + "ref" into a single step so the location of the element is known.
  const steps: Array<{ tok: PathToken; next?: PathToken }> = tokens.map((tok, i) => ({ tok, next: tokens[i + 1] }));
  let parent: Location | null = null;
  for (let i = 0; i < steps.length; i++) {
    const { tok, next } = steps[i];
    const here = formatPath(tokens.slice(0, i + 1));
    if ("ref" in tok) {
      if (!Array.isArray(cur)) throw new PathError(`"${formatPath(tokens.slice(0, i))}" is not an array, cannot look up "#${tok.ref}" in "${fullPath}".`);
      const found = findById(cur, tok.ref, tok.tree);
      if (!found) throw new PathError(`No element with id "${tok.ref}" (path "${fullPath}").`, tok.tree ? "List the layer ids with doc_summary / layer_list." : undefined);
      parent = { parent: found.container, key: found.index };
    } else if ("index" in tok) {
      if (!Array.isArray(cur)) throw new PathError(`"${formatPath(tokens.slice(0, i))}" is not an array (path "${fullPath}").`);
      if (tok.index > cur.length || (tok.index === cur.length && (i < steps.length - 1 || !create))) {
        throw new PathError(`Index ${tok.index} out of range at "${here}" (length ${cur.length}).`);
      }
      parent = { parent: cur, key: tok.index };
    } else {
      if (!isObj(cur)) throw new PathError(`"${formatPath(tokens.slice(0, i)) || "<root>"}" is not an object, cannot read "${tok.key}" (path "${fullPath}").`);
      parent = { parent: cur, key: tok.key };
    }
    if (i === steps.length - 1) return parent;
    let child: Json = (parent.parent as Record<string | number, unknown>)[parent.key as never];
    if (child === undefined || child === null) {
      if (!create) throw new PathError(`Nothing at "${here}" (path "${fullPath}").`);
      child = next && ("index" in next || "ref" in next) ? [] : {};
      (parent.parent as Record<string | number, unknown>)[parent.key as never] = child as never;
    }
    cur = child;
  }
  throw new PathError("Unreachable");
}

export function getAt(root: Json, path: string | PathToken[]): unknown {
  const tokens = typeof path === "string" ? parsePath(path) : path;
  const full = typeof path === "string" ? path : formatPath(tokens);
  const loc = locate(root, tokens, false, full);
  return (loc.parent as Record<string | number, unknown>)[loc.key as never];
}

export function hasAt(root: Json, path: string): boolean {
  try {
    return getAt(root, path) !== undefined;
  } catch {
    return false;
  }
}

// Sets a value, creating intermediate objects / arrays. Mutates `root`.
export function setAt(root: Json, path: string | PathToken[], value: unknown): void {
  const tokens = typeof path === "string" ? parsePath(path) : path;
  const full = typeof path === "string" ? path : formatPath(tokens);
  const loc = locate(root, tokens, true, full);
  (loc.parent as Record<string | number, unknown>)[loc.key as never] = value as never;
}

// Removes a key (or splices an array element). Returns false when nothing was there.
export function removeAt(root: Json, path: string | PathToken[]): boolean {
  const tokens = typeof path === "string" ? parsePath(path) : path;
  const full = typeof path === "string" ? path : formatPath(tokens);
  const loc = locate(root, tokens, false, full);
  if (Array.isArray(loc.parent)) {
    const idx = loc.key as number;
    if (idx >= loc.parent.length) return false;
    loc.parent.splice(idx, 1);
    return true;
  }
  if (!(String(loc.key) in loc.parent)) return false;
  delete loc.parent[String(loc.key)];
  return true;
}

// RFC 7396 JSON merge patch: objects merge recursively, arrays and scalars
// replace, `null` deletes the key. Returns a new value (inputs untouched).
export function mergePatch(target: unknown, patch: unknown): unknown {
  if (!isObj(patch)) return clone(patch);
  const out: Record<string, unknown> = isObj(target) ? { ...(target as Record<string, unknown>) } : {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k];
    else out[k] = mergePatch(out[k], v);
  }
  return out;
}

export function clone<T>(v: T): T {
  return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T);
}

// Stable JSON (sorted keys) for comparisons.
export function stableStringify(v: unknown): string {
  return JSON.stringify(sortKeys(v));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (isObj(v)) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) if (v[k] !== undefined) out[k] = sortKeys(v[k]);
    return out;
  }
  return v;
}

export function deepEqual(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}
