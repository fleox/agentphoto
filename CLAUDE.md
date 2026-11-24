# CLAUDE.md — AgentPhoto

AgentPhoto is **the photo studio your AI agent can run**. An agent (Claude Code, Claude, any MCP client) retouches photos and builds visuals — cut-outs, background removal, colour correction, looks, text, shapes, masks, layer effects, social / ad / thumbnail formats — by editing a JSON **document** (`photo.json`, a non-destructive layer stack), **looks at headless renders** to check its work, and **exports** PNG / JPEG / WebP / AVIF. A **Studio** (React) lets a human finish or do everything by hand. Successor of Photo Touch-up (`../photo-touch-up/`), architecture mirrored from Agent3D (`../agent-3d/`): when in doubt about a pattern (CLI framework, output contract, MCP server, Studio API, skills, versioning), **read the agent-3d equivalent and mirror it**.

## Hard rules

1. **Local, no server, no account.** Images never leave the computer. The only network use: the optional `assets_add { url }`, and the **one-time download of AI models** (Hugging Face) into a local cache (`~/.cache/agentphoto/models`, `AGENTPHOTO_MODELS` overrides) — the CLI proxies them at `/__models/`. No CDN, no analytics, no web fonts (fonts are bundled in `library/fonts`).
2. **One engine, four front doors.** Business logic lives in `src/ops/` (pure TS over `ProjectFs`, no DOM, no Node APIs); pixels in `src/engine/` (browser Canvas 2D, also run by headless Chrome). The CLI (`agent/`), the MCP server (`agent/mcp/`), the Studio (`src/studio/`) and the Studio assistant call ops / AI tools. Never re-implement a rule in a command or a page.
3. **The catalog is declared once** (`src/core/catalog.ts`): filters (+ params), looks, layer effects, blend modes, shapes, fonts, size presets, AI models. Validation, the engine's filter registry, AI tools, the Studio pickers and `docs/catalog.md` derive from it. A filter / look id without an engine implementation fails the tests.
4. **AI tools are declared once** in `src/ai/tools.ts` (name, description, JSON schema, `mutating`, `needsEngine`, handler). MCP `tools/list`, `agentphoto tools list|call`, the Studio API and the assistant expose exactly that list.
5. **Documents are data, non-destructive.** Everything is expressible in `photo.json`; source files are never modified. Painted edits (Studio brush / eraser / clone) are written as **new** files in `assets/edits/`, AI masks in `assets/masks/`. The render is a pure function of (document, files, fonts).
6. All code, comments, docs, skills: **English**. Agents translate for the user at runtime. The Studio UI is translated (en, fr).
7. `npm run typecheck`, `npm test`, `npm run build` must pass. Vitest tests next to the code (`*.test.ts`). Tests never touch the network.

## Layout

```
src/
  core/      types.ts (PhotoDoc — THE format), catalog.ts, validate.ts, fs.ts (ProjectFs + MemoryFs), jsonPath.ts, ids.ts, color.ts, suggest.ts, imageInfo.ts (header sizes), library.ts
  ops/       project.ts (create / load / save), doc.ts (summary, diff, apply, patch ops), geometry.ts (crop, canvas size, resample, rotate, flip — pure), tree.ts, assets.ts, check.ts, export.ts (planExport: sizes / formats / files), templates.ts, context.ts (OpsError)
  engine/    compositor.ts (PhotoDoc → canvas, cached), filters/ (pixels.ts primitives, index.ts FILTER_IMPLS, looks.ts), text.ts, paint.ts, effects.ts, loader.ts (URL loader + FontFace), analyze.ts, ai.ts (transformers.js: RMBG / MODNet / SAM), index.ts (Engine class), headless.ts (window.agentphoto for headless Chrome)
  ai/        tools.ts (catalog) + docTools.ts + imageTools.ts, shared.ts, types.ts (ToolHost, EngineHost)
  studio/    Studio SPA (React 19 + Tailwind 3 + lucide-react)
agent/       `agentphoto` CLI (Node ≥ 22, bundled to dist/agent/agentphoto.mjs) — commands/, mcp/, render/ (Chrome + CDP, local server, engine session), nodeFs.ts
library/     fonts/ (OFL woff2) + images/ (CC0 sample photos) + index.json + LICENSES.md
templates/   starter projects: <id>/photo.json, template.json { id, title, description, category, tags, width, height, slot?, subjectArea? }, preview.jpg
plugin/      Claude Code skills (plugin/skills/<name>/SKILL.md) + .claude-plugin/plugin.json
hermes/      Hermes Agent skills, generated from plugin/skills (+ python/ wrapper and helpers, tests/)
docs/        user docs (catalog.md + cli.md reference generated)
site/        the public site www.photo-touch-up.fr (online Studio + guide en / fr), built by scripts/build-site.mjs, deployed by .github/workflows/site.yml
```

### Builds

- `vite.engine.config.ts` → `dist/engine/agentphoto-engine.js` (+ `chunks/` transformers.js, `ort/` ONNX Runtime WASM). Aliases `onnxruntime-web/webgpu` to the non-bundled build (`ORT_ALIAS`) so WASM is not inlined — the Studio build must use the same alias.
- `vite.config.ts` → `dist/studio/` (Studio SPA).
- `vite.agent.config.ts` → `dist/agent/agentphoto.mjs`, every dependency inlined. The CLI finds engine, studio, library and templates relative to its file (`agent/paths.ts`, `AGENTPHOTO_DIST` overrides).

## The project folder

```
my-photo/
  agentphoto.json   { name, title, createdAt, updatedAt, template?, agentphoto }
  photo.json        PhotoDoc
  assets/           images/ (imported photos), masks/ (AI / Studio masks), edits/ (painted pixels) + manifest.json
  renders/          previews (render_preview)
  dist/             exports
```

## The document (src/core/types.ts)

`{ version: 1, id, title?, description?, canvas: { width, height, background? (Paint | null) }, layers: Layer[] (bottom → top), export? }`.
Layer common: `id, type, name?, visible?, locked?, opacity (0..1), blend (16 modes), mask?, clip?, filters?, effects?`.
Types: `image { src ("assets/…" | "library:<id>"), x, y, width?, height?, rotation, flipX/Y, crop?, fit: fill|cover|contain, focus? }`, `text { text, font (catalog id), size, weight, italic, color: Paint, align, valign, lineHeight, letterSpacing, transform, width? (wrap), height?, background? }`, `shape { shape: rect|ellipse|line|polygon|star, x, y, width, height, fill, stroke, radius, sides, innerRadius }`, `fill { fill: Paint }` (whole canvas), `adjustment { filters }` (filters what is below, inside its group), `group { children }`.
Paint = CSS colour | `{ type: "linear", stops, angle }` | `{ type: "radial", stops, cx, cy, radius }`. Mask = `{ src }` | `{ shape, x, y, width, height, radius }` | `{ gradient }` + `invert, feather, density, enabled` — layer-local px for box layers (stretched / moving with the layer), canvas px otherwise. Effects: `dropShadow, outerGlow, innerShadow, stroke, colorOverlay`.

Render pipeline per layer (`src/engine/compositor.ts`): content in layer space → filters → mask → transform (rotation / flip) → effects (canvas space) → clip to the layer below → draw with opacity + blend. Distance params (`px: true` in the catalog) scale with the render scale so previews match exports.

## Ops — signatures every front door uses

Errors: `OpsError(code, message, hint?, details?)` codes `notFound | validation | conflict | invalid | io | unavailable`.

```ts
createProject(fs, { name, title?, size? (preset id), width?, height?, background?, image?: { name, bytes, source?, license? }, template?, templateFiles?, force? }) → { manifest, doc, files, issues }
loadProject(fs) → { manifest, doc };  saveDoc(fs, doc, { allowInvalid? })
getDoc(fs);  summarizeDoc(doc) → DocSummary;  diffDocs(before, after) → DocPlan { empty, layers: { added, removed, changed, moved }, sections, summary }
applyDoc(fs, doc, { dryRun? }) → { plan, issues, applied }      // never throws on invalid docs
patchDoc(fs, ops, { dryRun?, sizes?, readLibrary? }) → { plan, issues, applied, doc }   // atomic; failing op → OpsError with details.opIndex
applyPatchOps(doc, ops, sizes?)   // pure. PATCH_OPS: set, merge, remove, addLayer, updateLayer, removeLayer, moveLayer, duplicateLayer, groupLayers, ungroup, addFilter, updateFilter, removeFilter, setMask, crop, resizeCanvas, resizeImage, rotateCanvas, flipCanvas, fitLayer
flattenLayers(doc) → FlatLayer[] (top → bottom);  findLayer / walkLayers / allLayerIds / referencedFiles (tree.ts)
addAsset(fs, { name, bytes, kind?, source, license?, author?, sourceUrl?, overwrite? }) → AssetEntry;  listAssets(fs);  removeAsset(fs, path, { force? });  addAssetFromUrl(fs, url, fetch)
checkProject(fs, { library? }) → CheckReport { ok, issues, counts, canvas, layers, cost, assetsKb, licences }
planExport(doc, { format, quality, preset, width, height, scale, fit, background, name, out }) → ExportJob { format, mime, quality, width, height, scale, source, dest, background, file }
listTemplates(index, { category?, query? });  findTemplate;  parseTemplateInfo;  instantiateTemplate
```

## Engine (src/engine/index.ts)

`new Engine({ assetBase, libraryBase, library, ai: { remoteHost, wasmPaths, onProgress } })` → `render(doc, { scale, skip, only, background, onError })`, `exportImage(doc, job)`, `analyze(doc, { layer })`, `layerPixels(doc, id)`, `backgroundMask(doc, id, { model, feather, threshold })`, `segmentMask(doc, id, { points, box }, { model })`, `colorRangeMask(doc, id, { color, tolerance })` (masks are PNG bytes in layer space, white = keep). `Compositor.layerBox(layer)` measures text with real fonts. `window.agentphoto` (headless.ts) wraps it with base64 in / out: `init`, `render`, `exportImage`, `analyze`, `backgroundMask`, `segmentMask`, `colorRangeMask`, `layerBoxes`.

## AI tools (src/ai/tools.ts)

`project_info, project_create, doc_summary, doc_get, doc_patch, doc_apply, doc_validate, layer_list, layer_add, layer_update, layer_remove, layer_move, filter_add, mask_set, remove_background*, mask_generate*, image_analyze*, render_preview*, catalog_get, templates_list, library_list, assets_list, assets_add, assets_remove, check, export*` (* = `needsEngine`: listed only when `host.engine` exists). `ToolContext { fs, fetch?, host: { engine?, library?, templates?, readLocalFile? } }`. `resultImages(name, result)` → image paths (render_preview) that MCP returns as `image` blocks and the assistant attaches.

## CLI contract (mirror of agent-3d)

- `--json` → exactly one `{ ok: true, data }` or `{ ok: false, error: { code, message, hint } }` on stdout; logs on stderr. Exit 0 ok, 1 failure, 2 usage / validation. Every error has an actionable `hint`.
- Destructive commands print `{ needsConfirmation: true, plan }` unless `--yes` (doc apply removing layers, layer remove, assets remove, export over existing files).
- The project is `--project <dir>` (default: cwd).
- Commands: `help`, `version`, `doctor`, `new <dir> [--image <file|url>] [--size <preset>] [--width --height] [--background] [--template <id>] [--title] [--force]`, `info`, `doc get|summary|apply|patch|validate`, `layer list|get|add|update|remove|move`, `filter add|update|remove`, `mask set|clear|generate`, `remove-bg <layer>`, `analyze`, `render`, `export`, `check`, `catalog [section] [id]`, `templates list|show`, `assets list|add|remove|library`, `models list|pull|remove`, `studio [--port] [--no-open]`, `tools list|call <name> --input`, `mcp [--read-only]`.
- Headless engine: `agent/render/` finds the installed Chrome / Chromium / Edge / Brave (`AGENTPHOTO_CHROME` overrides), serves `/__engine/`, `/__library/`, `/project/`, `/__models/` on 127.0.0.1, loads a page importing the engine, drives it with a hand-written CDP client (no puppeteer). One Chrome session is reused per process (MCP / Studio server keep it warm).

## Ownership boundaries (parallel work)

| Area | Folders |
|---|---|
| Engine + core (lead) | `src/core/`, `src/ops/`, `src/engine/`, `src/ai/`, `vite.engine.config.ts` |
| CLI | `agent/`, `vite.agent.config.ts`, `tsconfig.agent.json` |
| Studio | `src/studio/`, `index.html`, `vite.config.ts`, tailwind / postcss |
| Content | `templates/`, `library/` |
| Distribution | `plugin/`, `hermes/`, `.claude-plugin/`, `docs/` (except generated parts), `site/`, `scripts/`, `README.md`, `AGENTS.md`, `changelog.json` |

`src/core/types.ts`, `src/core/catalog.ts`, `src/ai/types.ts`, `src/engine/index.ts` are **contracts**: change them only additively and say so in your report.

## Contributor skills

Claude Code, this repo only — not distributed (the agent skills are `plugin/skills/`). In `.claude/skills/`: `agent-cli-internals` (CLI, MCP, headless engine session, model cache proxy, Studio API, AI tool exposure, skills, Hermes, releases, multi-agent QA), `engine-internals` (core types / catalog / validation, ops and patch ops, AI tools), `pixel-internals` (compositor, filters / looks, effects, text and fonts, local AI with transformers.js / ONNX Runtime, headless entry, engine build), `studio-internals` (Studio SPA + its API), `content-internals` (templates, library, recipes), `repo-presentation` (README / npm page, docs, images and demos, wording rules), `create-mr` (review + GitHub PR). `.claude/settings.json` allow-lists the read / check commands.
