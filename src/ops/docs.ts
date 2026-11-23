// docs/catalog.md is generated from the catalog (src/core/catalog.ts).
// src/ops/docs.test.ts fails when the file is stale; regenerate with
// `UPDATE_DOCS=1 npx vitest run src/ops/docs.test.ts`.

import { COMMON_FILTER_PARAMS, DEFAULT_MODELS, EFFECTS, FILTERS, FONTS, LAYER_TYPES, LOOKS, MODELS, SHAPES, SIZE_PRESETS, type FilterDef, type ParamDef } from "../core/catalog";
import { BLEND_MODES } from "../core/types";

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
const code = (v: unknown) => `\`${cell(typeof v === "string" ? v : JSON.stringify(v))}\``;
const anchor = (title: string) => title.toLowerCase().replace(/[^a-z0-9 -]/g, "").replace(/\s+/g, "-");

function paramType(p: ParamDef): string {
  if (p.type === "enum") {
    const opts = p.options ?? [];
    return opts.length > 8 ? `enum (${opts.length} values, see below)` : opts.map((o) => `\`${o}\``).join(" \\| ");
  }
  return `${p.type}${p.px ? " (px)" : ""}`;
}

function range(p: ParamDef): string {
  if (p.min === undefined && p.max === undefined) return "";
  return `${p.min ?? "−∞"} … ${p.max ?? "∞"}`;
}

function paramTable(params: ParamDef[]): string[] {
  if (!params.length) return ["_No parameters._", ""];
  return ["| Param | Type | Default | Range | Description |", "|---|---|---|---|---|", ...params.map((p) => `| \`${p.name}\` | ${cell(paramType(p))} | ${p.default === undefined ? "" : code(p.default)} | ${range(p)} | ${cell(p.description)} |`), ""];
}

const GROUPS: { id: FilterDef["group"]; title: string }[] = [
  { id: "light", title: "Light" },
  { id: "tone", title: "Tone" },
  { id: "color", title: "Color" },
  { id: "detail", title: "Detail" },
  { id: "blur", title: "Blur" },
  { id: "stylize", title: "Stylize" },
  { id: "auto", title: "Auto" },
  { id: "look", title: "Looks" },
];

function filterSection(f: FilterDef): string[] {
  const own = f.params.some((p) => p.name === "amount");
  const out = [`#### \`${f.id}\` — ${f.title}`, "", `${f.description} _Cost: ${f.cost} per megapixel._`, "", ...paramTable(f.params)];
  if (own) out.push("Here `amount` is the filter's own strength (not the 0 … 1 mix of the common params).", "");
  if (f.example) out.push("```json", JSON.stringify(f.example), "```", "");
  return out;
}

export function renderCatalogMarkdown(): string {
  const sections: [string, number][] = [
    ["Layer types", LAYER_TYPES.length],
    ["Blend modes", BLEND_MODES.length],
    ["Filters", FILTERS.length],
    ["Looks", LOOKS.length],
    ["Layer effects", EFFECTS.length],
    ["Shapes", SHAPES.length],
    ["Fonts", FONTS.length],
    ["Size presets", SIZE_PRESETS.length],
    ["AI models", MODELS.length],
  ];
  const out: string[] = [
    "# AgentPhoto catalog",
    "",
    "<!-- Generated from src/core/catalog.ts by renderCatalogMarkdown() (src/ops/docs.ts). Do not edit by hand. -->",
    "",
    "Everything a document (`photo.json`) can reference by id. Agents: query it with the `catalog_get` tool or `agentphoto catalog [section] [id]`.",
    "",
    "## Contents",
    "",
    ...sections.map(([t, n]) => `- [${t}](#${anchor(t)}) (${n})`),
    "",
    "## Layer types",
    "",
    'Layers are listed bottom → top in `layers`; every layer has `id`, `type`, and optionally `name`, `visible`, `locked`, `opacity` (0 … 1), `blend`, `mask`, `clip`, `filters`, `effects`.',
    "",
    "| Type | Description |",
    "|---|---|",
    ...LAYER_TYPES.map((t) => `| \`${t.id}\` | ${cell(t.description)} |`),
    "",
    "## Blend modes",
    "",
    "Layer `blend` (and `colorOverlay.blend`):",
    "",
    BLEND_MODES.map((b) => `\`${b}\``).join(", "),
    "",
    "## Filters",
    "",
    'Non-destructive, in order: `filters: [{ "type": "<id>", …params }]` on any layer, or on an `adjustment` layer to affect everything below it. Parameters marked _(px)_ scale with the render so previews match exports.',
    "",
    "Every filter also accepts:",
    "",
    ...paramTable(COMMON_FILTER_PARAMS),
  ];
  for (const g of GROUPS) {
    const list = FILTERS.filter((f) => f.group === g.id);
    if (!list.length) continue;
    out.push(`### ${g.title}`, "");
    for (const f of list) out.push(...filterSection(f));
  }
  out.push(
    "## Looks",
    "",
    'One-click grades: `{ "type": "look", "look": "<id>", "amount"?: 0 … 1 }`.',
    "",
    "| Look | Title | Description |",
    "|---|---|---|",
    ...LOOKS.map((l) => `| \`${l.id}\` | ${cell(l.title)} | ${cell(l.description)} |`),
    "",
    "## Layer effects",
    "",
    'Layer `effects: { "<id>": { …params } }` (`null` removes one). Drawn from the layer\'s shape after filters and mask.',
    "",
  );
  for (const e of EFFECTS) out.push(`### \`${e.id}\` — ${e.title}`, "", e.description, "", ...paramTable(e.params));
  out.push(
    "## Shapes",
    "",
    "Shape layer `shape`: " + SHAPES.map((s) => `\`${s}\``).join(", ") + ". Masks accept `rect` and `ellipse`.",
    "",
    "## Fonts",
    "",
    "Bundled (OFL, `library/fonts`): text layer `font: \"<id>\"`. Other names render with the computer's fonts.",
    "",
    "| Font | Family | Style | Weights | Description |",
    "|---|---|---|---|---|",
    ...FONTS.map((f) => `| \`${f.id}\` | ${cell(f.family)} | ${f.style} | ${f.weights.join(", ")}${f.italic?.length ? ` (italic ${f.italic.join(", ")})` : ""} | ${cell(f.description)} |`),
    "",
    "## Size presets",
    "",
    "`agentphoto new --size <id>`, `project_create { size }`, `export { preset }`.",
    "",
    "| Preset | Title | Size | Description |",
    "|---|---|---|---|",
    ...SIZE_PRESETS.map((s) => `| \`${s.id}\` | ${cell(s.title)} | ${s.width} × ${s.height} | ${cell(s.description)} |`),
    "",
    "## AI models",
    "",
    "Run locally (transformers.js); downloaded once from Hugging Face into `~/.cache/agentphoto/models` (`AGENTPHOTO_MODELS` overrides).",
    "",
    "| Model | Task | Repository | Size | Licence | Description |",
    "|---|---|---|---|---|---|",
    ...MODELS.map((m) => `| \`${m.id}\`${Object.values(DEFAULT_MODELS).includes(m.id as never) ? " (default)" : ""} | ${m.task} | ${m.repo} | ${m.sizeMb} MB | ${cell(m.license)} | ${cell(m.description)} |`),
    "",
  );
  return out.join("\n");
}
