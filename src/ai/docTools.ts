// Project / document / layer / catalog / check tools (no pixels needed).

import { CATALOG, type CatalogSection } from "../core/catalog";
import { listOptions } from "../core/suggest";
import { closest } from "../core/suggest";
import type { Filter, Layer, Mask, PhotoDoc } from "../core/types";
import { validateDoc } from "../core/validate";
import { listAssets, addAsset, removeAsset } from "../ops/assets";
import { checkProject } from "../ops/check";
import { OpsError } from "../ops/context";
import { applyDoc, flattenLayers, getDoc, patchDoc, PATCH_OPS, summarizeDoc, type PatchOp } from "../ops/doc";
import { createProject, loadProject } from "../ops/project";
import { findTemplate, listTemplates } from "../ops/templates";
import { bool, compactIssues, issueCounts, mutationResult, num, optStr, str } from "./shared";
import type { AiTool, JsonSchema, ToolContext } from "./types";

export const dryRunProp: JsonSchema = { type: "boolean", description: "Preview the plan and issues without writing (default false)." };

export const LAYER_SCHEMA: JsonSchema = {
  type: "object",
  description:
    'A layer: { "id": "title", "type": "image|text|shape|fill|adjustment|group", "name"?, "visible"?, "opacity" (0..1)?, "blend"?, "mask"?, "clip"?, "filters"?: [{ "type": …, …params }], "effects"?: { dropShadow, outerGlow, innerShadow, stroke, colorOverlay } } + by type — image { src: "assets/…" | "library:<id>", x, y, width?, height?, rotation?, flipX?, flipY?, crop?, fit?: fill|cover|contain, focus? }; text { text, x, y, width? (wraps), font (catalog id), size, weight, italic, color (colour | gradient), align, valign, lineHeight, letterSpacing, transform, background? { color, padding, radius } }; shape { shape: rect|ellipse|line|polygon|star, x, y, width, height, fill, stroke { color, width, dash }, radius, sides, innerRadius }; fill { fill: colour | gradient } (whole canvas); adjustment { filters } (affects layers below); group { children: [layers] }. Pixels, origin top-left, degrees.',
  additionalProperties: true,
};

const positionProps: Record<string, JsonSchema> = {
  parent: { type: ["string", "null"], description: "Group id to put it in (default: the root)." },
  index: { type: "integer", description: "Position in the parent, 0 = bottom (default: top)." },
  above: { type: "string", description: "Place it just above this layer id." },
  below: { type: "string", description: "Place it just below this layer id." },
};

const SECTIONS = Object.keys(CATALOG) as CatalogSection[];

function catalogGet(section?: string, id?: string): unknown {
  if (!section) {
    return {
      sections: {
        layerTypes: CATALOG.layerTypes.map((t) => `${t.id} — ${t.description}`),
        filters: CATALOG.filters.map((f) => `${f.id} (${f.group}) — ${f.description}`),
        looks: CATALOG.looks.map((l) => `${l.id} — ${l.description}`),
        effects: CATALOG.effects.map((e) => `${e.id} — ${e.description}`),
        blendModes: CATALOG.blendModes,
        shapes: CATALOG.shapes,
        fonts: CATALOG.fonts.map((f) => `${f.id} (${f.style}, weights ${f.weights.join("/")}) — ${f.description}`),
        sizes: CATALOG.sizes.map((s) => `${s.id} ${s.width}×${s.height} — ${s.title}`),
        models: CATALOG.models.map((m) => `${m.id} (${m.task}, ${m.sizeMb} MB) — ${m.description}`),
      },
      commonFilterParams: CATALOG.commonFilterParams,
      hint: 'catalog_get { section: "filters", id: "curves" } gives the parameters (types, ranges, defaults) and an example of one entry.',
    };
  }
  const sec = SECTIONS.find((s) => s.toLowerCase() === section.toLowerCase()) ?? SECTIONS.find((s) => s.toLowerCase().startsWith(section.toLowerCase()));
  if (!sec) {
    const s = closest(section, SECTIONS);
    throw new OpsError("notFound", `Unknown catalog section "${section}".`, `${s ? `Did you mean "${s}"? ` : ""}Sections: ${SECTIONS.join(", ")}.`);
  }
  const list = CATALOG[sec] as readonly unknown[];
  if (!id) return { section: sec, entries: list };
  const entry = (list as { id?: string }[]).find((e) => typeof e === "object" && e && e.id === id) ?? (list as unknown[]).find((e) => e === id);
  if (!entry) {
    const ids = (list as unknown[]).map((e) => (typeof e === "string" ? e : (e as { id: string }).id));
    const s = closest(id, ids);
    throw new OpsError("notFound", `No "${id}" in ${sec}.`, `${s ? `Did you mean "${s}"? ` : ""}Valid ids: ${listOptions(ids)}.`);
  }
  return { section: sec, entry };
}

async function patch(ctx: ToolContext, ops: PatchOp[], dryRun: boolean) {
  const lib = ctx.host?.library;
  const r = await patchDoc(ctx.fs, ops, {
    dryRun,
    readLibrary: lib
      ? async (id) => {
          const a = lib.index.assets.find((x) => x.id === id);
          return a?.path ? lib.read(a.path) : null;
        }
      : undefined,
  });
  return mutationResult(r, dryRun);
}

async function readInputImage(ctx: ToolContext, input: Record<string, unknown>, what: string): Promise<{ name: string; bytes: Uint8Array; source: string; sourceUrl?: string } | null> {
  const file = optStr(input, "file") ?? optStr(input, "image");
  const url = optStr(input, "url") ?? optStr(input, "imageUrl");
  if (file) {
    if (/^https?:\/\//.test(file)) return readUrl(ctx, file);
    if (!ctx.host?.readLocalFile) throw new OpsError("invalid", `${what}: this host cannot read local files.`, "Use url, or import the file from the Studio (drag & drop).");
    const bytes = await ctx.host.readLocalFile(file);
    // assets_add { name } renames the file; project_create's "name" is the project's, not the photo's.
    const rename = what === "assets_add" ? optStr(input, "name") : undefined;
    return { name: rename ?? file.split(/[\\/]/).pop() ?? "image", bytes, source: "user" };
  }
  if (url) return readUrl(ctx, url);
  return null;
}

async function readUrl(ctx: ToolContext, url: string) {
  if (!ctx.fetch) throw new OpsError("invalid", "This host has no network access for URLs.", "Download the file and pass its local path (file).");
  const res = await ctx.fetch(url, { headers: { accept: "image/*" } });
  if (!res.ok) throw new OpsError("io", `Download failed (HTTP ${res.status}): ${url}`);
  const u = new URL(url);
  return { name: decodeURIComponent(u.pathname.split("/").pop() || "image"), bytes: new Uint8Array(await res.arrayBuffer()), source: u.host, sourceUrl: url };
}

export const DOC_TOOLS: AiTool[] = [
  {
    name: "project_info",
    description: "The project: manifest, document summary (canvas, layers top → bottom with type, box, filters, masks, effects) and issue counts. Start here.",
    inputSchema: { type: "object", properties: {} },
    mutating: false,
    async handler(ctx) {
      const { manifest, doc } = await loadProject(ctx.fs);
      return { manifest, summary: summarizeDoc(doc), counts: issueCounts(validateDoc(doc)) };
    },
  },
  {
    name: "project_create",
    description:
      "Create a project in the current folder: blank (size preset or width / height), from a photo (image: local path or URL — the canvas takes its size, it becomes the \"photo\" layer), and / or from a template (templates_list). Fails if a project exists unless force.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Project name (slug)." },
        title: { type: "string" },
        image: { type: "string", description: "Local file path or http(s) URL of the starting photo." },
        size: { type: "string", description: 'Canvas size preset (catalog "sizes": og, square, story, youtube…).' },
        width: { type: "integer" },
        height: { type: "integer" },
        background: { type: ["string", "object", "null"], description: "Canvas background (colour, gradient, null = transparent)." },
        template: { type: "string", description: "Template id." },
        force: { type: "boolean", description: "Overwrite an existing project." },
      },
      required: ["name"],
    },
    mutating: true,
    async handler(ctx, input) {
      const image = await readInputImage(ctx, input, "project_create");
      const template = optStr(input, "template");
      let templateFiles: Record<string, Uint8Array | string> | undefined;
      if (template) {
        if (!ctx.host?.templates) throw new OpsError("invalid", "Templates are not available on this host.");
        findTemplate(ctx.host.templates.index, template);
        templateFiles = await ctx.host.templates.files(template);
      }
      const r = await createProject(ctx.fs, {
        name: str(input, "name"),
        title: optStr(input, "title"),
        size: optStr(input, "size"),
        width: num(input, "width"),
        height: num(input, "height"),
        background: input.background as PhotoDoc["canvas"]["background"],
        template,
        templateFiles,
        image: image ?? undefined,
        force: bool(input, "force"),
      });
      return { created: true, manifest: r.manifest, files: r.files, summary: summarizeDoc(r.doc), ...compactIssues(r.issues), hint: "Next: render_preview to see it, then layer_add / doc_patch to edit." };
    },
  },
  {
    name: "doc_get",
    description: "The full document (photo.json). Prefer doc_summary unless you need exact values.",
    inputSchema: { type: "object", properties: {} },
    mutating: false,
    handler: (ctx) => getDoc(ctx.fs),
  },
  {
    name: "doc_summary",
    description: "Compact outline: canvas size / background, layers top → bottom (id, type, detail, box [x, y, w, h], opacity, blend, mask kind, filters, effects, children), counts, sources.",
    inputSchema: { type: "object", properties: {} },
    mutating: false,
    handler: async (ctx) => summarizeDoc(await getDoc(ctx.fs)),
  },
  {
    name: "doc_apply",
    description: "Replace the whole document (validated; nothing written on errors). Destructive: confirm with the user when it removes layers. Use doc_patch for edits.",
    inputSchema: { type: "object", properties: { doc: { type: "object", description: "The full PhotoDoc { version: 1, id, title?, canvas: { width, height, background? }, layers: [...] }.", additionalProperties: true }, dryRun: dryRunProp }, required: ["doc"] },
    mutating: true,
    async handler(ctx, input) {
      const dry = bool(input, "dryRun");
      return mutationResult(await applyDoc(ctx.fs, input.doc as PhotoDoc, { dryRun: dry }), dry);
    },
  },
  {
    name: "doc_patch",
    description:
      `Atomic list of edits, validated together (nothing written if any fails). Ops: ${PATCH_OPS.join(", ")}. Shapes: { op: "set", path: "layers#title.size", value: 96 } · { op: "merge", path, value } (objects merge, null deletes) · { op: "remove", path } · { op: "addLayer", layer, parent?, index?, above?, below? } · { op: "updateLayer", id, set } (deep merge, null deletes a field) · { op: "removeLayer", id } · { op: "moveLayer", id, parent?, index?, above?, below? } · { op: "duplicateLayer", id, newId?, offset? } · { op: "groupLayers", ids, id, name? } · { op: "ungroup", id } · { op: "addFilter", id, filter, index? } · { op: "updateFilter", id, index, set } · { op: "removeFilter", id, index } · { op: "setMask", id, mask | null } · { op: "crop", x, y, width, height } · { op: "resizeCanvas", width, height, anchor? } · { op: "resizeImage", width?, height?, scale? } · { op: "rotateCanvas", angle: 90|180|270 } · { op: "flipCanvas", axis: horizontal|vertical }. Paths: "canvas.background", "layers#<id>.<field>", "layers#<id>.filters[0].radius".`,
    inputSchema: { type: "object", properties: { ops: { type: "array", items: { type: "object", additionalProperties: true }, description: "Patch operations, applied in order." }, dryRun: dryRunProp }, required: ["ops"] },
    mutating: true,
    handler: (ctx, input) => patch(ctx, input.ops as PatchOp[], bool(input, "dryRun")),
  },
  {
    name: "doc_validate",
    description: "Validate a document (the given one, or photo.json): issues with JSON paths and hints.",
    inputSchema: { type: "object", properties: { doc: { type: "object", additionalProperties: true } } },
    mutating: false,
    async handler(ctx, input) {
      const doc = (input.doc as PhotoDoc | undefined) ?? (await getDoc(ctx.fs));
      const issues = validateDoc(doc);
      return { valid: !issues.some((i) => i.severity === "error"), counts: issueCounts(issues), ...compactIssues(issues) };
    },
  },
  {
    name: "layer_list",
    description: "Every layer top → bottom (flat, with parent and depth): id, type, detail, box, opacity, blend, mask, filters (in order — their index is what updateFilter / removeFilter use), effects.",
    inputSchema: { type: "object", properties: {} },
    mutating: false,
    handler: async (ctx) => ({ layers: flattenLayers(await getDoc(ctx.fs)) }),
  },
  {
    name: "layer_add",
    description: "Add a layer (validated). Default position: top of the stack. Image layers need a src from assets_add / library_list.",
    inputSchema: { type: "object", properties: { layer: LAYER_SCHEMA, ...positionProps, dryRun: dryRunProp }, required: ["layer"] },
    mutating: true,
    handler: (ctx, input) => patch(ctx, [{ op: "addLayer", layer: input.layer as Layer, parent: input.parent as string | null | undefined, index: num(input, "index"), above: optStr(input, "above"), below: optStr(input, "below") }], bool(input, "dryRun")),
  },
  {
    name: "layer_update",
    description: 'Change fields of a layer (deep merge; null removes a field, e.g. { "mask": null }). Cannot change id / type / children.',
    inputSchema: { type: "object", properties: { id: { type: "string" }, set: { type: "object", additionalProperties: true, description: 'Fields to change, e.g. { "x": 40, "opacity": 0.8, "effects": { "dropShadow": { "blur": 24 } } }.' }, dryRun: dryRunProp }, required: ["id", "set"] },
    mutating: true,
    handler: (ctx, input) => patch(ctx, [{ op: "updateLayer", id: str(input, "id"), set: input.set as Record<string, unknown> }], bool(input, "dryRun")),
  },
  {
    name: "layer_remove",
    description: "Remove a layer (and its children for a group). Its files stay in assets/.",
    inputSchema: { type: "object", properties: { id: { type: "string" }, dryRun: dryRunProp }, required: ["id"] },
    mutating: true,
    handler: (ctx, input) => patch(ctx, [{ op: "removeLayer", id: str(input, "id") }], bool(input, "dryRun")),
  },
  {
    name: "layer_move",
    description: "Reorder a layer: above / below another layer, or into a group at an index.",
    inputSchema: { type: "object", properties: { id: { type: "string" }, ...positionProps, dryRun: dryRunProp }, required: ["id"] },
    mutating: true,
    handler: (ctx, input) => patch(ctx, [{ op: "moveLayer", id: str(input, "id"), parent: input.parent as string | null | undefined, index: num(input, "index"), above: optStr(input, "above"), below: optStr(input, "below") }], bool(input, "dryRun")),
  },
  {
    name: "filter_add",
    description: 'Add a non-destructive filter to a layer (or to an adjustment layer — which affects everything below). e.g. { id: "photo", filter: { "type": "exposure", "exposure": 0.4 } }. catalog_get section "filters" lists them.',
    inputSchema: { type: "object", properties: { id: { type: "string", description: "Layer id." }, filter: { type: "object", additionalProperties: true, description: "{ type, ...params, amount? }" }, index: { type: "integer" }, dryRun: dryRunProp }, required: ["id", "filter"] },
    mutating: true,
    handler: (ctx, input) => patch(ctx, [{ op: "addFilter", id: str(input, "id"), filter: input.filter as Filter, index: num(input, "index") }], bool(input, "dryRun")),
  },
  {
    name: "mask_set",
    description: 'Set (or remove with null) a layer mask: { "src": "assets/masks/x.png" } | { "shape": "rect|ellipse", x, y, width, height, radius? } | { "gradient": { type, angle, stops } } + invert, feather, density, enabled. Box layers: layer-local px (0,0 = the layer\'s top-left). For AI masks use remove_background / mask_generate.',
    inputSchema: { type: "object", properties: { id: { type: "string" }, mask: { type: ["object", "null"], additionalProperties: true }, dryRun: dryRunProp }, required: ["id"] },
    mutating: true,
    handler: (ctx, input) => patch(ctx, [{ op: "setMask", id: str(input, "id"), mask: (input.mask ?? null) as Mask | null }], bool(input, "dryRun")),
  },
  {
    name: "catalog_get",
    description: "The catalog: layer types, filters (+ params), looks, layer effects, blend modes, shapes, bundled fonts, size presets, AI models. No input = an overview; { section, id } = one entry with its parameters.",
    inputSchema: { type: "object", properties: { section: { type: "string", enum: SECTIONS }, id: { type: "string" } } },
    mutating: false,
    handler: (_ctx, input) => catalogGet(optStr(input, "section"), optStr(input, "id")),
  },
  {
    name: "templates_list",
    description: "Starter templates (social posts, thumbnails, ads, product shots…) with their size and the slot that receives the user's photo. Use with project_create { template, image }.",
    inputSchema: { type: "object", properties: { category: { type: "string" }, query: { type: "string" } } },
    mutating: false,
    handler: (ctx, input) => ({ templates: listTemplates(ctx.host?.templates?.index ?? [], { category: optStr(input, "category"), query: optStr(input, "query") }) }),
  },
  {
    name: "check",
    description: "Everything to fix before export: validation, missing files, layers off the canvas, upscaled (blurry) photos, text that may overflow, heavy filters, licences needing attribution.",
    inputSchema: { type: "object", properties: {} },
    mutating: false,
    async handler(ctx) {
      const r = await checkProject(ctx.fs, { library: ctx.host?.library?.index });
      return { ...r, ...compactIssues(r.issues) };
    },
  },
  {
    name: "assets_list",
    description: "Project files (photos, masks, edits) with size, source, licence and the layers using them.",
    inputSchema: { type: "object", properties: {} },
    mutating: false,
    handler: (ctx) => listAssets(ctx.fs),
  },
  {
    name: "assets_add",
    description: "Import an image into assets/images/ from a local path (file) or an http(s) URL (url). With addLayer: true it also adds an image layer (on top, fitted inside the canvas) and returns its id.",
    inputSchema: {
      type: "object",
      properties: {
        file: { type: "string", description: "Local file path (CLI / MCP hosts)." },
        url: { type: "string", description: "http(s) URL of an image." },
        name: { type: "string", description: "File name to store it as." },
        license: { type: "string" },
        author: { type: "string" },
        addLayer: { type: "boolean", description: "Also add it as a layer." },
        layerId: { type: "string", description: "Id of the new layer (default from the file name)." },
      },
    },
    mutating: true,
    async handler(ctx, input) {
      const img = await readInputImage(ctx, input, "assets_add");
      if (!img) throw new OpsError("invalid", "assets_add needs file or url.");
      const entry = await addAsset(ctx.fs, { name: optStr(input, "name") ?? img.name, bytes: img.bytes, kind: "image", source: img.source, sourceUrl: img.sourceUrl, license: optStr(input, "license"), author: optStr(input, "author") });
      if (!bool(input, "addLayer")) return { asset: entry, hint: `Use it as { "type": "image", "src": "${entry.path}" } (layer_add).` };
      const doc = await getDoc(ctx.fs);
      const { uniqueId, slugify } = await import("../core/ids");
      const { allLayerIds } = await import("../ops/tree");
      const id = uniqueId(optStr(input, "layerId") ?? slugify(entry.path.split("/").pop()!.replace(/\.[^.]+$/, ""), "image"), allLayerIds(doc));
      const W = doc.canvas.width;
      const H = doc.canvas.height;
      const w = entry.width ?? W;
      const h = entry.height ?? H;
      const k = Math.min(1, W / w, H / h);
      const layer: Layer = { id, type: "image", src: entry.path, x: Math.round((W - w * k) / 2), y: Math.round((H - h * k) / 2), width: Math.round(w * k), height: Math.round(h * k) };
      const r = await patch(ctx, [{ op: "addLayer", layer }], false);
      return { asset: entry, layer: id, ...r };
    },
  },
  {
    name: "assets_remove",
    description: "Delete a project file. Refused while a layer uses it unless force.",
    inputSchema: { type: "object", properties: { path: { type: "string" }, force: { type: "boolean" } }, required: ["path"] },
    mutating: true,
    handler: (ctx, input) => removeAsset(ctx.fs, str(input, "path"), { force: bool(input, "force") }),
  },
  {
    name: "library_list",
    description: 'Built-in assets: sample photos (CC0, use as "library:<id>" in an image layer src) and fonts (use the id as a text layer font).',
    inputSchema: { type: "object", properties: { kind: { type: "string", enum: ["image", "font"] }, query: { type: "string" } } },
    mutating: false,
    handler(ctx, input) {
      const kind = optStr(input, "kind");
      const words = (optStr(input, "query") ?? "").toLowerCase().split(/\s+/).filter(Boolean);
      const assets = (ctx.host?.library?.index.assets ?? [])
        .filter((a) => !kind || a.kind === kind)
        .filter((a) => words.every((w) => `${a.id} ${a.title ?? ""} ${a.description} ${a.tags.join(" ")}`.toLowerCase().includes(w)))
        .map((a) => ({ id: a.id, kind: a.kind, ref: a.kind === "image" ? `library:${a.id}` : a.id, ...(a.width ? { size: `${a.width}×${a.height}` } : {}), license: a.license, description: a.description, tags: a.tags }));
      return { assets, total: assets.length };
    },
  },
];
