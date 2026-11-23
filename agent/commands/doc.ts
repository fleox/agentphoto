import { CliError, printResult } from "../output";
import type { Command, CommandOption } from "./types";
import {
  boolOpt,
  deepMerge,
  DRY_RUN_OPTION,
  FILE_OPTION,
  jsonInput,
  jsonObjectOpt,
  jsonOpt,
  numOpt,
  positional,
  PROJECT_OPTION,
  projectFs,
  runMutation,
  setPairs,
  strOpt,
  table,
  tool,
  usage,
  YES_OPTION,
  type MutationResult,
  type Options,
} from "./util";
import { issuesLine } from "./util";

// doc / layer / filter / mask: read photo.json and change it through the AI
// tools (src/ai/docTools.ts → src/ops/doc.ts). Every write is validated; a
// change that removes layers prints a plan with needsConfirmation unless --yes.

type PatchOp = Record<string, unknown> & { op: string };

// ─── doc ────────────────────────────────────────────────────────────────

export const docCommand: Command = {
  name: "doc",
  usage: "doc <get|summary|apply|patch|validate> [--project <dir>]",
  summary: "Read, replace, patch and validate photo.json (the PhotoDoc). apply / patch are validated (nothing written on errors); removing layers needs --yes.",
  subcommands: [
    { name: "get", usage: "doc get [--path <json.path>]", summary: 'The full document, or the value at a path ("canvas", "layers#title.size").' },
    { name: "summary", usage: "doc summary", summary: "Compact outline: canvas, layers top → bottom (id, type, detail, box, opacity, blend, mask, filters, effects), counts, sources." },
    { name: "apply", usage: "doc apply --file <photo.json|-> [--dry-run] [--yes]", summary: "Replace the whole document (validated). Prints the plan + needsConfirmation when it removes layers, unless --yes.", writes: true, destructive: true },
    { name: "patch", usage: "doc patch --file <ops.json|-> [--dry-run] [--yes]", summary: 'Apply patch ops atomically ([{ "op": "set", "path": "layers#title.size", "value": 96 }, { "op": "addFilter", "id": "photo", "filter": {…} }, …] — `agentphoto tools list` documents doc_patch). Removing layers needs --yes.', writes: true },
    { name: "validate", usage: "doc validate [--file <photo.json|->]", summary: "Validate the project's document (or a candidate file): issues with JSON paths, messages and hints. Exit 2 on errors." },
  ],
  options: [PROJECT_OPTION, FILE_OPTION, { name: "path", type: "string", description: "get: a JSON path into the document." }, DRY_RUN_OPTION, YES_OPTION],
  async run({ io, options, positionals }) {
    const [action = "summary", ...rest] = positionals;
    if (action === "validate") {
      const candidate = strOpt(options, "file") !== undefined || rest.length ? jsonInput(options, rest, "the document", "--file photo.json") : undefined;
      const fs = candidate ? projectFs(options, { mustExist: false }) : projectFs(options);
      const r = await tool<{ valid: boolean; counts: { errors: number; warnings: number }; issues: { severity: string; path?: string; message: string; hint?: string }[] }>(fs, "doc_validate", candidate ? { doc: candidate } : {});
      printResult(io, r, () => (r.valid ? "Valid.\n" : `${r.counts.errors} error(s):\n`) + issuesLine(r.issues));
      return r.valid ? 0 : 2;
    }
    const fs = projectFs(options);
    if (action === "get") {
      const doc = await tool<Record<string, unknown>>(fs, "doc_get", {});
      const path = strOpt(options, "path");
      if (!path) return printResult(io, doc, () => JSON.stringify(doc, null, 2));
      const { getAt } = await import("../../src/core/jsonPath");
      const value = getAt(doc as Parameters<typeof getAt>[0], path);
      if (value === undefined) throw new CliError("notFound", `Nothing at "${path}".`, "`agentphoto doc summary` lists the layer ids; paths look like canvas.background or layers#title.color.");
      return printResult(io, { path, value }, () => JSON.stringify(value, null, 2));
    }
    if (action === "summary") {
      const summary = await tool(fs, "doc_summary", {});
      return printResult(io, summary, () => JSON.stringify(summary, null, 2));
    }
    if (action === "apply") {
      const doc = jsonInput(options, rest, "the document", "--file photo.json");
      if (!doc || typeof doc !== "object" || Array.isArray(doc)) usage("The document must be a JSON object (a PhotoDoc).");
      return runMutation(io, options, fs, "doc_apply", { doc }, "Replace photo.json");
    }
    if (action === "patch") {
      const raw = jsonInput(options, rest, "the patch ops", `--file ops.json with [{"op":"set","path":"canvas.background","value":"#101020"}]`);
      const ops = (Array.isArray(raw) ? raw : raw && typeof raw === "object" && Array.isArray((raw as { ops?: unknown }).ops) ? (raw as { ops: unknown[] }).ops : [raw]) as PatchOp[];
      if (!ops.length || ops.some((o) => !o || typeof o !== "object" || typeof o.op !== "string"))
        usage('The patch must be an array of ops with an "op" field.', 'e.g. [{"op":"set","path":"canvas.background","value":"#101020"},{"op":"removeLayer","id":"old"}]');
      return runMutation(io, options, fs, "doc_patch", { ops }, `Patch (${ops.length} op${ops.length > 1 ? "s" : ""})`);
    }
    usage(`Unknown doc action "${action}".`, "Use get, summary, apply, patch or validate.");
  },
};

// ─── layer ──────────────────────────────────────────────────────────────

const POSITION_OPTIONS: CommandOption[] = [
  { name: "above", type: "string", description: "add / move: place it just above this layer id." },
  { name: "below", type: "string", description: "add / move: place it just below this layer id." },
  { name: "parent", type: "string", description: 'add / move: group id to put it in ("root" = the top level).' },
  { name: "index", type: "string", description: "add / move: position in the parent, 0 = bottom (default: top)." },
];

function position(options: Options): Record<string, unknown> {
  const parent = strOpt(options, "parent");
  const index = numOpt(options, "index");
  return {
    ...(strOpt(options, "above") ? { above: strOpt(options, "above") } : {}),
    ...(strOpt(options, "below") ? { below: strOpt(options, "below") } : {}),
    ...(parent !== undefined ? { parent: parent === "root" || parent === "null" ? null : parent } : {}),
    ...(index !== undefined ? { index } : {}),
  };
}

// --layer json + shortcuts (--id, --type, --text, --src) + --set a.b=v.
function layerDef(options: Options): Record<string, unknown> {
  let def: Record<string, unknown> = { ...(jsonObjectOpt(options, "layer") ?? {}) };
  for (const k of ["id", "type", "text", "src", "name"]) {
    const v = strOpt(options, k);
    if (v !== undefined) def[k] = v;
  }
  if (def.text !== undefined && !def.type) def.type = "text";
  if (def.src !== undefined && !def.type) def.type = "image";
  def = deepMerge(def, setPairs(options));
  return def;
}

export const layerCommand: Command = {
  name: "layer",
  usage: "layer <list|get|add|update|remove|move> [<id>] [--project <dir>]",
  summary: "List, inspect, add, change, remove and reorder layers (image, text, shape, fill, adjustment, group).",
  subcommands: [
    { name: "list", usage: "layer list", summary: "Every layer top → bottom (flat, with parent / depth): id, type, detail, box, opacity, blend, mask, filters (their index is what filter update / remove use), effects." },
    { name: "get", usage: "layer get <id>", summary: "One layer's full definition." },
    { name: "add", usage: 'layer add --layer <json|@file> | --id <id> --type text --text "Hello" [--set k=v …] [--above|--below <id>] [--parent <group>] [--index <n>]', summary: "Add a layer (validated). Default position: top of the stack.", writes: true },
    { name: "update", usage: "layer update <id> [--layer <json>] [--set k=v …]", summary: 'Change fields of a layer (deep merge; --set effects.dropShadow.blur=24 changes only that key; --set mask=null removes a field).', writes: true },
    { name: "remove", usage: "layer remove <id> [--yes]", summary: "Remove a layer (and its children for a group); its files stay in assets/. Plan + needsConfirmation unless --yes.", writes: true, destructive: true },
    { name: "move", usage: "layer move <id> (--above <id> | --below <id> | --parent <group> [--index <n>] | --index <n>)", summary: "Reorder a layer or move it into a group.", writes: true },
  ],
  options: [
    PROJECT_OPTION,
    { name: "layer", type: "string", description: "add: the layer as JSON (@file, - = stdin); update: the fields to change." },
    { name: "set", type: "string", multiple: true, description: 'key=value (dotted keys, JSON values), repeated: --set x=40 --set color="#ff3366" --set effects.dropShadow.blur=24.' },
    { name: "id", type: "string", description: "add: the new layer's id ([a-zA-Z][a-zA-Z0-9_-]*)." },
    { name: "type", type: "string", description: "add: image, text, shape, fill, adjustment or group." },
    { name: "text", type: "string", description: "add: the text (implies --type text)." },
    { name: "src", type: "string", description: 'add: image source, "assets/…" or "library:<id>" (implies --type image).' },
    { name: "name", type: "string", description: "add: display name." },
    ...POSITION_OPTIONS,
    DRY_RUN_OPTION,
    YES_OPTION,
  ],
  async run({ io, options, positionals }) {
    const [action = "list"] = positionals;
    const fs = projectFs(options);
    if (action === "list") {
      const { layers } = await tool<{ layers: (Record<string, unknown> & { depth: number; id: string })[] }>(fs, "layer_list", {});
      return printResult(io, { layers }, () => table(layers.map((l) => ({ ...l, id: `${"  ".repeat(l.depth)}${l.id}`, filters: (l.filters as string[] | undefined)?.join(",") })), ["id", "type", "detail", "box", "mask", "filters"]));
    }
    if (action === "get") {
      const id = positional(positionals, 1, "layer id", "layer get <id>");
      const doc = await tool<{ layers: never[] }>(fs, "doc_get", {});
      const { findLayer } = await import("../../src/ops/tree");
      const hit = findLayer(doc.layers, id);
      if (!hit) throw new CliError("notFound", `No layer "${id}".`, "`agentphoto layer list` lists the layer ids.");
      return printResult(io, { layer: hit.layer, parent: hit.parent?.id ?? null, index: hit.index, depth: hit.depth }, () => JSON.stringify(hit.layer, null, 2));
    }
    if (action === "add") {
      const layer = layerDef(options);
      if (!layer.id || !layer.type) usage("layer add needs an id and a type.", 'e.g. --id title --text "Summer sale" --set x=80 --set y=80 --set size=96, or --layer \'{"id":"bg","type":"fill","fill":"#101820"}\'');
      return runMutation(io, options, fs, "layer_add", { layer, ...position(options) }, `Add ${String(layer.type)} layer "${String(layer.id)}"`);
    }
    if (action === "update") {
      const id = positional(positionals, 1, "layer id", "layer update <id> --set k=v");
      const set = deepMerge(jsonObjectOpt(options, "layer") ?? {}, setPairs(options));
      if (!Object.keys(set).length) usage("Nothing to change.", "Pass --set key=value (repeated) and/or --layer '{…}'.");
      return runMutation(io, options, fs, "layer_update", { id, set }, `Update "${id}"`);
    }
    if (action === "remove") {
      const id = positional(positionals, 1, "layer id", "layer remove <id>");
      return runMutation(io, options, fs, "layer_remove", { id }, `Remove "${id}"`, { destructive: true });
    }
    if (action === "move") {
      const id = positional(positionals, 1, "layer id", "layer move <id> --above <id>");
      const pos = position(options);
      if (!Object.keys(pos).length) usage("layer move needs --above, --below, --parent or --index.");
      return runMutation(io, options, fs, "layer_move", { id, ...pos }, `Move "${id}"`);
    }
    usage(`Unknown layer action "${action}".`, "Use list, get, add, update, remove or move.");
  },
};

// ─── filter ─────────────────────────────────────────────────────────────

export const filterCommand: Command = {
  name: "filter",
  usage: "filter <add|update|remove> <layer> [<index>] [--project <dir>]",
  summary: "Non-destructive filters on a layer (or on an adjustment layer — it affects everything below): add, change or remove one. `agentphoto catalog filters` lists them with their parameters.",
  subcommands: [
    { name: "add", usage: "filter add <layer> (--filter <json> | --type <filter> [--set k=v …]) [--index <n>]", summary: 'Add a filter, e.g. --type exposure --set exposure=0.3, or --filter \'{"type":"look","look":"film"}\'.', writes: true },
    { name: "update", usage: "filter update <layer> <index> (--set k=v … | --filter <json>)", summary: "Change parameters of the filter at <index> (layer list shows the order).", writes: true },
    { name: "remove", usage: "filter remove <layer> <index>", summary: "Remove the filter at <index>.", writes: true },
  ],
  options: [
    PROJECT_OPTION,
    { name: "filter", type: "string", description: "The filter as JSON ({ type, ...params, amount? }), @file or -." },
    { name: "type", type: "string", description: "add: filter type (catalog id)." },
    { name: "set", type: "string", multiple: true, description: "Filter parameters as key=value (repeated)." },
    { name: "index", type: "string", description: "add: position in the layer's filter list (default: last)." },
    DRY_RUN_OPTION,
    YES_OPTION,
  ],
  async run({ io, options, positionals }) {
    const [action, layer] = positionals;
    if (!action) usage("Missing action.", "Use filter add|update|remove <layer>.");
    const fs = projectFs(options);
    if (action === "add") {
      const id = positional(positionals, 1, "layer id", "filter add <layer> --type exposure --set exposure=0.3");
      const filter = deepMerge({ ...(jsonObjectOpt(options, "filter") ?? {}), ...(strOpt(options, "type") ? { type: strOpt(options, "type") } : {}) }, setPairs(options));
      if (!filter.type) usage("filter add needs --type <filter> or --filter <json>.", "e.g. filter add photo --type exposure --set exposure=0.3 (`agentphoto catalog filters` lists them).");
      const index = numOpt(options, "index");
      return runMutation(io, options, fs, "filter_add", { id, filter, ...(index !== undefined ? { index } : {}) }, `Add filter ${String(filter.type)} to "${id}"`);
    }
    if (action === "update" || action === "remove") {
      const id = positional(positionals, 1, "layer id", `filter ${action} <layer> <index>`);
      const raw = positionals[2] ?? strOpt(options, "index");
      const index = Number(raw);
      if (raw === undefined || !Number.isInteger(index) || index < 0) usage(`filter ${action} needs the filter index (0 = first; \`agentphoto layer get ${id}\` shows them).`);
      if (action === "remove") return runMutation(io, options, fs, "doc_patch", { ops: [{ op: "removeFilter", id, index }] }, `Remove filter ${index} of "${id}"`);
      const set = deepMerge(jsonObjectOpt(options, "filter") ?? {}, setPairs(options));
      if (!Object.keys(set).length) usage("Nothing to change.", "Pass --set key=value (repeated) or --filter '{…}'.");
      return runMutation(io, options, fs, "doc_patch", { ops: [{ op: "updateFilter", id, index, set }] }, `Update filter ${index} of "${id}"`);
    }
    void layer;
    usage(`Unknown filter action "${action}".`, "Use add, update or remove.");
  },
};

// ─── mask ───────────────────────────────────────────────────────────────

function parseNumbers(raw: string, what: string, count: number): number[] {
  const nums = raw.replace(/^\[|\]$/g, "").split(/[\s,]+/).filter(Boolean).map(Number);
  if (nums.length !== count || nums.some((n) => !Number.isFinite(n))) usage(`${what} must be ${count} numbers, got "${raw}".`);
  return nums;
}

export const maskCommand: Command = {
  name: "mask",
  usage: "mask <set|clear|generate> <layer> [--project <dir>]",
  summary: "Layer masks: set one (image / shape / gradient), clear it, or generate one from pixels with local AI or a colour range (subject, points, box, color) — non-destructive, the mask PNG goes to assets/masks/.",
  subcommands: [
    { name: "set", usage: "mask set <layer> --mask <json|@file>", summary: 'Set a mask: {"src":"assets/masks/x.png"} | {"shape":"ellipse","x":0,"y":0,"width":400,"height":300,"feather":20} | {"gradient":{…}} (+ invert, feather, density, enabled). Box layers: layer-local px.', writes: true },
    { name: "clear", usage: "mask clear <layer>", summary: "Remove the layer's mask (the file stays in assets/).", writes: true },
    {
      name: "generate",
      usage: "mask generate <layer> --method subject|points|box|color [--points <json>] [--box x1,y1,x2,y2] [--color <c>] [--tolerance <0-100>] [--invert] [--feather <px>] [--model <id>] [--target mask|copy]",
      summary: 'Make a mask from pixels (needs Chrome; AI models download once): subject (main subject), points (Segment Anything, [[x,y,1|0],…] in layer px), box, color (colour range). --invert keeps the rest; --target copy masks a duplicate instead.',
      writes: true,
    },
  ],
  options: [
    PROJECT_OPTION,
    { name: "mask", type: "string", description: "set: the mask as JSON, @file or -." },
    { name: "method", type: "string", description: "generate: subject, points, box or color." },
    { name: "points", type: "string", description: "generate --method points: [[x, y, 1 = include | 0 = exclude], …] in layer px." },
    { name: "box", type: "string", description: "generate --method box: x1,y1,x2,y2 in layer px." },
    { name: "color", type: "string", description: "generate --method color: the colour to select." },
    { name: "tolerance", type: "string", description: "generate --method color: 0..100 (default 32)." },
    { name: "invert", type: "boolean", description: "generate: keep everything except the selection." },
    { name: "feather", type: "string", description: "generate: soften the edge, px." },
    { name: "model", type: "string", description: "generate: AI model id (`agentphoto models list`)." },
    { name: "target", type: "string", description: "generate: mask (default, the layer itself) or copy (duplicate the layer and mask the copy)." },
    { name: "copy-id", type: "string", description: "generate --target copy: id of the copy." },
    DRY_RUN_OPTION,
    YES_OPTION,
  ],
  async run({ io, options, positionals }) {
    const [action] = positionals;
    if (!action) usage("Missing action.", "Use mask set|clear|generate <layer>.");
    const fs = projectFs(options);
    if (action === "set") {
      const id = positional(positionals, 1, "layer id", "mask set <layer> --mask <json>");
      const mask = jsonOpt(options, "mask", `--mask '{"shape":"ellipse","x":0,"y":0,"width":400,"height":300,"feather":20}'`);
      if (mask === undefined) usage("mask set needs --mask <json>.", "Use `mask clear <layer>` to remove a mask.");
      return runMutation(io, options, fs, "mask_set", { id, mask }, `Set the mask of "${id}"`);
    }
    if (action === "clear") {
      const id = positional(positionals, 1, "layer id", "mask clear <layer>");
      return runMutation(io, options, fs, "mask_set", { id, mask: null }, `Clear the mask of "${id}"`);
    }
    if (action === "generate") {
      const id = positional(positionals, 1, "layer id", "mask generate <layer> --method subject");
      const method = strOpt(options, "method");
      if (!method || !["subject", "points", "box", "color"].includes(method)) usage("mask generate needs --method subject|points|box|color.", "e.g. mask generate photo --method points --points '[[640,420,1]]'");
      const input: Record<string, unknown> = { id, method };
      if (method === "points") {
        const points = jsonOpt(options, "points", `--points '[[640,420,1],[100,80,0]]'`);
        if (!Array.isArray(points) || !points.length || points.some((p) => !Array.isArray(p) || p.length < 2)) usage("--method points needs --points '[[x,y,1],…]' (layer px; 1 = include, 0 = exclude).");
        input.points = points;
      }
      if (method === "box") {
        const raw = strOpt(options, "box");
        if (!raw) usage("--method box needs --box x1,y1,x2,y2 (layer px).");
        input.box = parseNumbers(raw, "--box", 4);
      }
      if (method === "color") {
        const color = strOpt(options, "color");
        if (!color) usage('--method color needs --color "<colour>" (e.g. "#3a7bd5").');
        input.color = color;
        if (numOpt(options, "tolerance") !== undefined) input.tolerance = numOpt(options, "tolerance");
      }
      if (boolOpt(options, "invert")) input.invert = true;
      if (numOpt(options, "feather") !== undefined) input.feather = numOpt(options, "feather");
      if (strOpt(options, "model")) input.model = strOpt(options, "model");
      if (strOpt(options, "target")) input.target = strOpt(options, "target");
      if (strOpt(options, "copy-id")) input.copyId = strOpt(options, "copy-id");
      const r = await tool<MutationResult & { mask: string; layer?: string }>(fs, "mask_generate", input);
      if (r.status === "refused") throw new CliError("validation", "The generated mask could not be applied.", "See details.issues.", 2, { issues: r.issues });
      return printResult(io, { ...r, maskFile: `${fs.root}/${r.mask}` }, () => `Mask ${r.mask} (${String(r.size)}) set on "${r.layer ?? id}". ${r.plan.summary}\nLook at it: agentphoto render --project ${fs.root}`);
    }
    usage(`Unknown mask action "${action}".`, "Use set, clear or generate.");
  },
};
