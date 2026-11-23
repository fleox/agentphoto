// Validation of a PhotoDoc: structure + catalog parameters (types, ranges,
// enums, unknown ids / fields / params → "did you mean"). Issues carry the JSON
// path agents use with doc_patch ("layers#title.size", "layers#bg.filters[0].radius").
// Pure (no DOM, no Node).

import { CATALOG, COMMON_FILTER_PARAMS, EFFECTS, filterDef, fontDef, FONTS, type ParamDef } from "./catalog";
import { isValidColor } from "./color";
import { isValidId } from "./ids";
import { didYouMean, listOptions } from "./suggest";
import { BLEND_MODES, DOC_VERSION, type Issue, type Layer, type PhotoDoc } from "./types";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export const MAX_CANVAS = 16384;
export const LARGE_CANVAS_MP = 40;

const COMMON_LAYER_KEYS = ["id", "type", "name", "visible", "locked", "opacity", "blend", "mask", "clip", "filters", "effects"];
const PLACEMENT_KEYS = ["x", "y", "width", "height", "rotation", "flipX", "flipY"];
const LAYER_KEYS: Record<string, string[]> = {
  image: [...COMMON_LAYER_KEYS, ...PLACEMENT_KEYS, "src", "crop", "fit", "focus"],
  text: [...COMMON_LAYER_KEYS, ...PLACEMENT_KEYS, "text", "font", "size", "weight", "italic", "color", "align", "valign", "lineHeight", "letterSpacing", "transform", "background"],
  shape: [...COMMON_LAYER_KEYS, ...PLACEMENT_KEYS, "shape", "fill", "stroke", "radius", "sides", "innerRadius"],
  fill: [...COMMON_LAYER_KEYS, "fill"],
  adjustment: [...COMMON_LAYER_KEYS],
  group: [...COMMON_LAYER_KEYS, "children"],
};
const LAYER_TYPE_IDS = Object.keys(LAYER_KEYS);
const ROOT_KEYS = ["version", "id", "title", "description", "canvas", "layers", "export"];

export class Collector {
  issues: Issue[] = [];
  add(severity: Issue["severity"], code: string, path: string, message: string, hint?: string) {
    this.issues.push({ severity, code, path, message, ...(hint ? { hint } : {}) });
  }
  error(code: string, path: string, message: string, hint?: string) {
    this.add("error", code, path, message, hint);
  }
  warn(code: string, path: string, message: string, hint?: string) {
    this.add("warning", code, path, message, hint);
  }
  info(code: string, path: string, message: string, hint?: string) {
    this.add("info", code, path, message, hint);
  }
}

function unknownKeys(c: Collector, obj: Obj, allowed: readonly string[], path: string, what: string) {
  for (const k of Object.keys(obj)) {
    if (allowed.includes(k)) continue;
    c.warn("unknown-field", path ? `${path}.${k}` : k, `Unknown field "${k}" on ${what} (ignored).`, `${didYouMean(k, allowed)}Allowed: ${listOptions(allowed)}.`);
  }
}

function number(c: Collector, v: unknown, path: string, opts: { min?: number; max?: number; int?: boolean; required?: boolean; what?: string } = {}): v is number {
  if (v === undefined) {
    if (opts.required) c.error("missing", path, `${opts.what ?? path} is required.`);
    return false;
  }
  if (!isNum(v)) {
    c.error("type", path, `${path} must be a number, got ${JSON.stringify(v)}.`);
    return false;
  }
  if (opts.int && !Number.isInteger(v)) c.error("type", path, `${path} must be an integer, got ${v}.`);
  if (opts.min !== undefined && v < opts.min) c.error("range", path, `${path} must be ≥ ${opts.min}, got ${v}.`);
  if (opts.max !== undefined && v > opts.max) c.error("range", path, `${path} must be ≤ ${opts.max}, got ${v}.`);
  return true;
}

function bool(c: Collector, v: unknown, path: string) {
  if (v !== undefined && typeof v !== "boolean") c.error("type", path, `${path} must be true or false, got ${JSON.stringify(v)}.`);
}

function color(c: Collector, v: unknown, path: string, required = false) {
  if (v === undefined) {
    if (required) c.error("missing", path, `${path} (a CSS colour) is required.`);
    return;
  }
  if (!isValidColor(v)) c.error("color", path, `${path}: ${JSON.stringify(v)} is not a CSS colour.`, 'Use "#ff3366", "rgb(255 51 102)", "hsl(340 100% 60%)", "rgba(0,0,0,0.5)" or a named colour.');
}

function stops(c: Collector, v: unknown, path: string) {
  if (!Array.isArray(v) || v.length < 2) {
    c.error("stops", path, `${path} must list at least 2 colour stops.`, 'e.g. ["#1b1340", "#ff7a59"] or [[0, "#000"], [0.6, "#f80"], [1, "#fff"]].');
    return;
  }
  v.forEach((s, i) => {
    const p = `${path}[${i}]`;
    if (typeof s === "string") color(c, s, p);
    else if (Array.isArray(s) && s.length === 2) {
      number(c, s[0], `${p}[0]`, { min: 0, max: 1 });
      color(c, s[1], `${p}[1]`, true);
    } else c.error("stops", p, `${p} must be a colour or [offset 0..1, colour].`);
  });
}

export function validatePaint(c: Collector, v: unknown, path: string, opts: { allowNull?: boolean; required?: boolean } = {}) {
  if (v === undefined) {
    if (opts.required) c.error("missing", path, `${path} is required (a CSS colour or a gradient).`);
    return;
  }
  if (v === null) {
    if (!opts.allowNull) c.error("type", path, `${path} cannot be null.`);
    return;
  }
  if (typeof v === "string") return color(c, v, path);
  if (!isObj(v)) return c.error("paint", path, `${path} must be a CSS colour or a gradient object.`, '{ "type": "linear", "angle": 90, "stops": ["#ff7a59", "#1b1340"] }');
  if (v.type !== "linear" && v.type !== "radial") c.error("paint", `${path}.type`, `Gradient type must be "linear" or "radial", got ${JSON.stringify(v.type)}.`);
  stops(c, v.stops, `${path}.stops`);
  if (v.type === "linear") {
    unknownKeys(c, v, ["type", "stops", "angle"], path, "a linear gradient");
    number(c, v.angle, `${path}.angle`);
  } else if (v.type === "radial") {
    unknownKeys(c, v, ["type", "stops", "cx", "cy", "radius"], path, "a radial gradient");
    number(c, v.cx, `${path}.cx`);
    number(c, v.cy, `${path}.cy`);
    number(c, v.radius, `${path}.radius`, { min: 0 });
  }
}

// One catalog param value.
function param(c: Collector, def: ParamDef, v: unknown, path: string) {
  switch (def.type) {
    case "number":
    case "int":
      number(c, v, path, { min: def.min, max: def.max, int: def.type === "int" });
      return;
    case "boolean":
      bool(c, v, path);
      return;
    case "color":
      color(c, v, path);
      return;
    case "enum":
      if (typeof v !== "string" || !def.options?.includes(v)) c.error("enum", path, `${path}: ${JSON.stringify(v)} is not one of the allowed values.`, `${typeof v === "string" ? didYouMean(v, def.options ?? []) : ""}Allowed: ${listOptions(def.options ?? [])}.`);
      return;
    case "stops":
      stops(c, v, path);
      return;
    case "rgb":
      if (!Array.isArray(v) || v.length !== 3) c.error("type", path, `${path} must be [r, g, b] (each ${def.min}..${def.max}).`);
      else v.forEach((x, k) => number(c, x, `${path}[${k}]`, { min: def.min, max: def.max }));
      return;
    case "curve": {
      if (!Array.isArray(v) || v.length < 2) {
        c.error("curve", path, `${path} must list at least 2 points [input, output] (0..255).`, "e.g. [[0,0],[64,50],[192,210],[255,255]].");
        return;
      }
      let last = -1;
      v.forEach((pt, k) => {
        const p = `${path}[${k}]`;
        if (!Array.isArray(pt) || pt.length !== 2) return c.error("curve", p, `${p} must be [input, output].`);
        number(c, pt[0], `${p}[0]`, { min: 0, max: 255 });
        number(c, pt[1], `${p}[1]`, { min: 0, max: 255 });
        if (isNum(pt[0])) {
          if (pt[0] <= last) c.error("curve", p, `${path}: inputs must be strictly increasing (point ${k} has ${pt[0]} after ${last}).`);
          last = pt[0];
        }
      });
      return;
    }
  }
}

function params(c: Collector, obj: Obj, defs: ParamDef[], path: string, what: string, skip: string[]) {
  const allowed = [...skip, ...defs.map((d) => d.name)];
  for (const [k, v] of Object.entries(obj)) {
    if (skip.includes(k)) continue;
    const def = defs.find((d) => d.name === k);
    if (!def) {
      c.warn("unknown-param", `${path}.${k}`, `Unknown parameter "${k}" for ${what} (ignored).`, `${didYouMean(k, allowed)}Parameters: ${listOptions(defs.map((d) => d.name))}. catalog_get documents them.`);
      continue;
    }
    if (v === undefined) continue;
    param(c, def, v, `${path}.${k}`);
  }
}

export function validateFilter(c: Collector, f: unknown, path: string) {
  if (!isObj(f)) return c.error("type", path, `${path} must be a filter object { "type": …, …params }.`, 'e.g. { "type": "brightnessContrast", "brightness": 10 }.');
  if (typeof f.type !== "string") return c.error("missing", `${path}.type`, `${path}.type (a filter id) is required.`, `Filters: ${listOptions(CATALOG.filters.map((x) => x.id))}.`);
  const def = filterDef(f.type);
  if (!def) return c.error("unknown-filter", `${path}.type`, `Unknown filter "${f.type}".`, `${didYouMean(f.type, CATALOG.filters.map((x) => x.id))}Filters: ${listOptions(CATALOG.filters.map((x) => x.id))} (catalog_get section "filters").`);
  // A filter's own param shadows a common one ("amount" is the strength of sharpen / clarity / noise / vignette, not the mix).
  const common = COMMON_FILTER_PARAMS.filter((p) => !def.params.some((d) => d.name === p.name));
  for (const p of common) if (f[p.name] !== undefined) param(c, p, f[p.name], `${path}.${p.name}`);
  params(c, f, def.params, path, `filter "${def.id}"`, ["type", ...common.map((p) => p.name)]);
  if (def.id === "look" && f.look === undefined) c.error("missing", `${path}.look`, `A "look" filter needs a look id.`, `Looks: ${listOptions(CATALOG.looks.map((l) => l.id))}.`);
}

function filters(c: Collector, v: unknown, path: string) {
  if (v === undefined) return;
  if (!Array.isArray(v)) return c.error("type", path, `${path} must be an array of filters.`);
  v.forEach((f, k) => validateFilter(c, f, `${path}[${k}]`));
}

function mask(c: Collector, m: unknown, path: string) {
  if (m === undefined || m === null) return;
  if (!isObj(m)) return c.error("type", path, `${path} must be a mask object.`, '{ "src": "assets/masks/photo.png" } | { "shape": "ellipse", "x": 0, "y": 0, "width": 400, "height": 400, "feather": 30 } | { "gradient": { "type": "linear", "angle": 90, "stops": ["white", "black"] } }');
  const kinds = ["src", "shape", "gradient"].filter((k) => m[k] !== undefined);
  if (kinds.length !== 1) c.error("mask", path, `${path} must have exactly one of "src", "shape" or "gradient" (has ${kinds.length ? kinds.join(", ") : "none"}).`);
  const common = ["invert", "feather", "density", "enabled"];
  bool(c, m.invert, `${path}.invert`);
  bool(c, m.enabled, `${path}.enabled`);
  number(c, m.feather, `${path}.feather`, { min: 0, max: 1000 });
  number(c, m.density, `${path}.density`, { min: 0, max: 1 });
  if (m.src !== undefined) {
    unknownKeys(c, m, ["src", ...common], path, "an image mask");
    if (typeof m.src !== "string" || !m.src.trim()) c.error("type", `${path}.src`, `${path}.src must be a project path (e.g. "assets/masks/photo.png").`);
  } else if (m.shape !== undefined) {
    unknownKeys(c, m, ["shape", "x", "y", "width", "height", "radius", ...common], path, "a shape mask");
    if (m.shape !== "rect" && m.shape !== "ellipse") c.error("enum", `${path}.shape`, `${path}.shape must be "rect" or "ellipse".`);
    number(c, m.x, `${path}.x`, { required: true });
    number(c, m.y, `${path}.y`, { required: true });
    number(c, m.width, `${path}.width`, { required: true, min: 0 });
    number(c, m.height, `${path}.height`, { required: true, min: 0 });
    number(c, m.radius, `${path}.radius`, { min: 0 });
  } else if (m.gradient !== undefined) {
    unknownKeys(c, m, ["gradient", ...common], path, "a gradient mask");
    if (typeof m.gradient === "string") c.error("paint", `${path}.gradient`, `${path}.gradient must be a gradient object, not a colour.`);
    else validatePaint(c, m.gradient, `${path}.gradient`);
  }
}

function effects(c: Collector, v: unknown, path: string) {
  if (v === undefined) return;
  if (!isObj(v)) return c.error("type", path, `${path} must be an object { dropShadow?, outerGlow?, innerShadow?, stroke?, colorOverlay? }.`);
  const ids = EFFECTS.map((e) => e.id as string);
  for (const [k, val] of Object.entries(v)) {
    const def = EFFECTS.find((e) => e.id === k);
    const p = `${path}.${k}`;
    if (!def) {
      c.warn("unknown-effect", p, `Unknown layer effect "${k}" (ignored).`, `${didYouMean(k, ids)}Effects: ${listOptions(ids)}.`);
      continue;
    }
    if (val === null || val === false) continue;
    if (!isObj(val)) {
      c.error("type", p, `${p} must be an object of parameters (or null to remove it).`);
      continue;
    }
    params(c, val, def.params, p, `effect "${k}"`, []);
    if (k === "colorOverlay" && val.color === undefined) c.error("missing", `${p}.color`, `colorOverlay needs a color.`);
  }
}

function placement(c: Collector, l: Obj, path: string, opts: { sizeRequired?: boolean } = {}) {
  number(c, l.x, `${path}.x`);
  number(c, l.y, `${path}.y`);
  number(c, l.width, `${path}.width`, { min: 0, required: opts.sizeRequired });
  number(c, l.height, `${path}.height`, { min: 0, required: opts.sizeRequired });
  number(c, l.rotation, `${path}.rotation`);
  bool(c, l.flipX, `${path}.flipX`);
  bool(c, l.flipY, `${path}.flipY`);
}

function layer(c: Collector, l: unknown, path: string, ids: Set<string>) {
  if (!isObj(l)) return c.error("type", path, `${path} must be a layer object.`);
  const lp = typeof l.id === "string" && isValidId(l.id) ? `layers#${l.id}` : path;
  if (!isValidId(l.id)) c.error("id", `${path}.id`, `Layer id ${JSON.stringify(l.id)} is invalid.`, "Ids start with a letter and contain letters, digits, - and _ (e.g. \"photo\", \"title-2\").");
  else if (ids.has(l.id)) c.error("duplicate-id", `${lp}.id`, `Duplicate layer id "${l.id}".`, "Layer ids are unique across the document (groups included).");
  else ids.add(l.id);
  if (typeof l.type !== "string" || !LAYER_KEYS[l.type]) {
    c.error("layer-type", `${lp}.type`, `Unknown layer type ${JSON.stringify(l.type)}.`, `${typeof l.type === "string" ? didYouMean(l.type, LAYER_TYPE_IDS) : ""}Types: ${listOptions(LAYER_TYPE_IDS)}.`);
    return;
  }
  unknownKeys(c, l, LAYER_KEYS[l.type], lp, `a ${l.type} layer`);
  if (l.name !== undefined && typeof l.name !== "string") c.error("type", `${lp}.name`, `${lp}.name must be a string.`);
  bool(c, l.visible, `${lp}.visible`);
  bool(c, l.locked, `${lp}.locked`);
  bool(c, l.clip, `${lp}.clip`);
  if (l.opacity !== undefined) {
    if (isNum(l.opacity) && l.opacity > 1 && l.opacity <= 100) c.error("range", `${lp}.opacity`, `${lp}.opacity is 0..1, got ${l.opacity}.`, `Use ${Math.round(l.opacity) / 100} for ${l.opacity} %.`);
    else number(c, l.opacity, `${lp}.opacity`, { min: 0, max: 1 });
  }
  if (l.blend !== undefined && (typeof l.blend !== "string" || !(BLEND_MODES as readonly string[]).includes(l.blend)))
    c.error("enum", `${lp}.blend`, `Unknown blend mode ${JSON.stringify(l.blend)}.`, `${typeof l.blend === "string" ? didYouMean(l.blend, BLEND_MODES) : ""}Blend modes: ${listOptions(BLEND_MODES)}.`);
  mask(c, l.mask, `${lp}.mask`);
  effects(c, l.effects, `${lp}.effects`);

  switch (l.type) {
    case "image":
      filters(c, l.filters, `${lp}.filters`);
      placement(c, l, lp);
      if (typeof l.src !== "string" || !l.src.trim()) c.error("missing", `${lp}.src`, `Image layer "${l.id}" needs a src (a project path like "assets/photo.jpg" or "library:<id>").`, "assets_add imports a file into the project; library_list lists the built-in images.");
      if (l.crop !== undefined) {
        if (!isObj(l.crop)) c.error("type", `${lp}.crop`, `${lp}.crop must be { x, y, width, height } in source pixels.`);
        else {
          number(c, l.crop.x, `${lp}.crop.x`, { required: true, min: 0 });
          number(c, l.crop.y, `${lp}.crop.y`, { required: true, min: 0 });
          number(c, l.crop.width, `${lp}.crop.width`, { required: true, min: 1 });
          number(c, l.crop.height, `${lp}.crop.height`, { required: true, min: 1 });
        }
      }
      if (l.fit !== undefined && !["fill", "cover", "contain"].includes(l.fit as string)) c.error("enum", `${lp}.fit`, `${lp}.fit must be "fill", "cover" or "contain".`);
      if (l.focus !== undefined && (!Array.isArray(l.focus) || l.focus.length !== 2 || !l.focus.every((x) => isNum(x) && x >= 0 && x <= 1))) c.error("type", `${lp}.focus`, `${lp}.focus must be [x, y] with values 0..1.`);
      break;
    case "text":
      filters(c, l.filters, `${lp}.filters`);
      placement(c, l, lp);
      if (typeof l.text !== "string") c.error("missing", `${lp}.text`, `Text layer "${l.id}" needs a text string.`);
      else if (!l.text.trim()) c.warn("empty-text", `${lp}.text`, `Text layer "${l.id}" is empty.`);
      if (l.font !== undefined) {
        if (typeof l.font !== "string" || !l.font.trim()) c.error("type", `${lp}.font`, `${lp}.font must be a font id or a CSS font family.`);
        else if (!fontDef(l.font)) {
          const near = didYouMean(l.font, FONTS.map((f) => f.id));
          c.info("system-font", `${lp}.font`, `Font "${l.font}" is not bundled: it renders with whatever this computer has (exports may differ elsewhere).`, `${near}Bundled fonts: ${listOptions(FONTS.map((f) => f.id))}.`);
        }
      }
      number(c, l.size, `${lp}.size`, { min: 1, max: 4000 });
      number(c, l.weight, `${lp}.weight`, { min: 100, max: 900 });
      bool(c, l.italic, `${lp}.italic`);
      validatePaint(c, l.color, `${lp}.color`);
      if (l.align !== undefined && !["left", "center", "right"].includes(l.align as string)) c.error("enum", `${lp}.align`, `${lp}.align must be left, center or right.`);
      if (l.valign !== undefined && !["top", "middle", "bottom"].includes(l.valign as string)) c.error("enum", `${lp}.valign`, `${lp}.valign must be top, middle or bottom.`);
      number(c, l.lineHeight, `${lp}.lineHeight`, { min: 0.1, max: 10 });
      number(c, l.letterSpacing, `${lp}.letterSpacing`, { min: -200, max: 1000 });
      if (l.transform !== undefined && !["none", "uppercase", "lowercase"].includes(l.transform as string)) c.error("enum", `${lp}.transform`, `${lp}.transform must be none, uppercase or lowercase.`);
      if (l.background !== undefined && l.background !== null) {
        if (!isObj(l.background)) c.error("type", `${lp}.background`, `${lp}.background must be { color, padding?, radius? } or null.`);
        else {
          unknownKeys(c, l.background, ["color", "padding", "radius"], `${lp}.background`, "a text background");
          color(c, l.background.color, `${lp}.background.color`, true);
          const pad = l.background.padding;
          if (pad !== undefined && !isNum(pad) && !(Array.isArray(pad) && pad.length === 2 && pad.every(isNum))) c.error("type", `${lp}.background.padding`, "padding must be a number or [horizontal, vertical].");
          number(c, l.background.radius, `${lp}.background.radius`, { min: 0 });
        }
      }
      break;
    case "shape":
      filters(c, l.filters, `${lp}.filters`);
      placement(c, l, lp, { sizeRequired: true });
      if (typeof l.shape !== "string" || !CATALOG.shapes.includes(l.shape as never)) c.error("enum", `${lp}.shape`, `${lp}.shape must be one of ${listOptions(CATALOG.shapes)}.`, typeof l.shape === "string" ? didYouMean(l.shape, CATALOG.shapes) : undefined);
      validatePaint(c, l.fill, `${lp}.fill`, { allowNull: true });
      if (l.stroke !== undefined && l.stroke !== null) {
        if (!isObj(l.stroke)) c.error("type", `${lp}.stroke`, `${lp}.stroke must be { color, width?, dash? } or null.`);
        else {
          unknownKeys(c, l.stroke, ["color", "width", "dash"], `${lp}.stroke`, "a stroke");
          color(c, l.stroke.color, `${lp}.stroke.color`, true);
          number(c, l.stroke.width, `${lp}.stroke.width`, { min: 0 });
          if (l.stroke.dash !== undefined && (!Array.isArray(l.stroke.dash) || !l.stroke.dash.every((x) => isNum(x) && x >= 0))) c.error("type", `${lp}.stroke.dash`, "dash must be an array of lengths, e.g. [12, 6].");
        }
      }
      if (l.fill === undefined && (l.stroke === undefined || l.stroke === null) && l.shape !== "line") c.info("invisible-shape", lp, `Shape "${l.id}" has no fill and no stroke: it draws the default fill (#ffffff).`);
      if (l.shape === "line" && (l.stroke === undefined || l.stroke === null)) c.info("line-stroke", lp, `Line "${l.id}" has no stroke: it draws a 4 px white line.`);
      number(c, l.radius, `${lp}.radius`, { min: 0 });
      number(c, l.sides, `${lp}.sides`, { min: 3, max: 64, int: true });
      number(c, l.innerRadius, `${lp}.innerRadius`, { min: 0, max: 1 });
      break;
    case "fill":
      filters(c, l.filters, `${lp}.filters`);
      validatePaint(c, l.fill, `${lp}.fill`, { required: true });
      break;
    case "adjustment":
      if (!Array.isArray(l.filters)) c.error("missing", `${lp}.filters`, `Adjustment layer "${l.id}" needs a filters array.`, 'e.g. "filters": [{ "type": "brightnessContrast", "contrast": 15 }]');
      else {
        if (!l.filters.length) c.warn("empty-adjustment", `${lp}.filters`, `Adjustment layer "${l.id}" has no filters (does nothing).`);
        filters(c, l.filters, `${lp}.filters`);
      }
      break;
    case "group":
      filters(c, l.filters, `${lp}.filters`);
      if (!Array.isArray(l.children)) c.error("missing", `${lp}.children`, `Group "${l.id}" needs a children array.`);
      else l.children.forEach((ch, k) => layer(c, ch, `${lp}.children[${k}]`, ids));
      break;
  }
}

export function validateDoc(doc: unknown): Issue[] {
  const c = new Collector();
  if (!isObj(doc)) {
    c.error("type", "", "The document must be a JSON object.", 'Minimal: { "version": 1, "id": "photo", "canvas": { "width": 1200, "height": 630 }, "layers": [] }');
    return c.issues;
  }
  unknownKeys(c, doc, ROOT_KEYS, "", "the document");
  if (doc.version === undefined) c.warn("version", "version", `Missing "version" (assumed ${DOC_VERSION}).`);
  else if (doc.version !== DOC_VERSION) c.error("version", "version", `Unsupported document version ${JSON.stringify(doc.version)} (this engine reads ${DOC_VERSION}).`, "Update agentphoto, or set version to 1.");
  if (!isValidId(doc.id)) c.error("id", "id", `Document id ${JSON.stringify(doc.id)} is invalid.`, 'Use a slug such as "summer-sale".');
  if (doc.title !== undefined && typeof doc.title !== "string") c.error("type", "title", "title must be a string.");
  if (doc.description !== undefined && typeof doc.description !== "string") c.error("type", "description", "description must be a string.");
  if (!isObj(doc.canvas)) c.error("missing", "canvas", 'canvas { width, height } is required.', '"canvas": { "width": 1200, "height": 630 }');
  else {
    unknownKeys(c, doc.canvas, ["width", "height", "background"], "canvas", "canvas");
    number(c, doc.canvas.width, "canvas.width", { required: true, min: 1, max: MAX_CANVAS, int: true });
    number(c, doc.canvas.height, "canvas.height", { required: true, min: 1, max: MAX_CANVAS, int: true });
    if (isNum(doc.canvas.width) && isNum(doc.canvas.height) && (doc.canvas.width * doc.canvas.height) / 1e6 > LARGE_CANVAS_MP)
      c.warn("large-canvas", "canvas", `The canvas is ${Math.round((doc.canvas.width * doc.canvas.height) / 1e6)} megapixels: renders and exports will be slow and memory-hungry.`, "Most web uses need ≤ 4000 px on the long side (resize_image).");
    validatePaint(c, doc.canvas.background, "canvas.background", { allowNull: true });
  }
  if (!Array.isArray(doc.layers)) c.error("missing", "layers", "layers (an array, bottom → top) is required.");
  else {
    const ids = new Set<string>();
    doc.layers.forEach((l, k) => layer(c, l, `layers[${k}]`, ids));
  }
  if (doc.export !== undefined) {
    if (!isObj(doc.export)) c.error("type", "export", "export must be an object of default export settings.");
    else {
      unknownKeys(c, doc.export, ["format", "quality", "scale", "width", "height", "background", "name"], "export", "export settings");
      if (doc.export.format !== undefined && !["png", "jpeg", "webp", "avif"].includes(doc.export.format as string)) c.error("enum", "export.format", 'export.format must be "png", "jpeg", "webp" or "avif".');
      number(c, doc.export.quality, "export.quality", { min: 1, max: 100 });
      number(c, doc.export.scale, "export.scale", { min: 0.01, max: 8 });
      number(c, doc.export.width, "export.width", { min: 1, max: MAX_CANVAS, int: true });
      number(c, doc.export.height, "export.height", { min: 1, max: MAX_CANVAS, int: true });
      if (doc.export.background !== undefined && doc.export.background !== null) color(c, doc.export.background, "export.background");
      if (doc.export.name !== undefined && (typeof doc.export.name !== "string" || !/^[\w.-]+$/.test(doc.export.name))) c.error("type", "export.name", "export.name must be a file name without extension (letters, digits, . _ -).");
    }
  }
  return c.issues;
}

export const errorsOf = (issues: Issue[]) => issues.filter((i) => i.severity === "error");

// Structural defaults only (never invents content).
export function normalizeDoc(doc: PhotoDoc): PhotoDoc {
  // Only a missing layer list defaults to []: a wrong value stays so validation reports it (never silently drops layers).
  return { ...doc, version: doc.version ?? DOC_VERSION, layers: doc.layers === undefined || doc.layers === null ? [] : doc.layers };
}

export function defaultDoc(opts: { id?: string; title?: string; width?: number; height?: number; background?: PhotoDoc["canvas"]["background"] } = {}): PhotoDoc {
  return {
    version: DOC_VERSION,
    id: opts.id ?? "photo",
    ...(opts.title ? { title: opts.title } : {}),
    canvas: { width: opts.width ?? 1200, height: opts.height ?? 630, ...(opts.background !== undefined ? { background: opts.background } : {}) },
    layers: [] as Layer[],
  };
}
