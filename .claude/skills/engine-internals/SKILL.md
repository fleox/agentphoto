---
name: engine-internals
description: Contributor notes for the AgentPhoto engine core — the PhotoDoc contract and DOC_VERSION (src/core/types.ts), the catalog and its params (src/core/catalog.ts: filters, looks, effects, blend modes, shapes, fonts, size presets, AI models, `px` and `cost`), validation (validate.ts: key allow-lists, did-you-mean hints, normalizeDoc), json paths (layers#id), colours, the library index, ProjectFs / MemoryFs, and src/ops/ (project create / load / save, templates, doc summary / diff / apply, the PATCH_OPS and the pure geometry ops, layer tree, assets with injected fetch, check, planExport, docs/catalog.md generation) plus the AI tool catalog (src/ai/: tools.ts, docTools.ts, imageTools.ts, shared.ts, types.ts). Invoke when adding or changing a catalog entry, a document field, a validation or check rule, a patch op, an export option, an asset rule, an op or an AI tool in this repository.
---

# Engine core (core, ops, AI tools) — contributor notes (this repo)

Read [CLAUDE.md](../../../CLAUDE.md) ("Hard rules", "The document", "Ops", "AI tools", "Ownership boundaries") and [AGENTS.md](../../../AGENTS.md) ("The catalog is declared once", "The document format is a contract") first. Don't commit unless asked. `src/core/types.ts`, `src/core/catalog.ts` and `src/ai/types.ts` are contracts: additive changes only, and say so in your report. The pixels (compositor, filter implementations, effects, text, local AI): [`pixel-internals`](../pixel-internals/SKILL.md); commands, MCP, skills and Hermes: [`agent-cli-internals`](../agent-cli-internals/SKILL.md); the inspector and pickers: [`studio-internals`](../studio-internals/SKILL.md); templates and the library: [`content-internals`](../content-internals/SKILL.md).

## Where things live

| Concern | Code | Tests |
|---|---|---|
| Document format | `src/core/types.ts` (`PhotoDoc`, `DOC_VERSION = 1`, `Layer` union, `Paint`, `Mask` + `isImageMask` / `isShapeMask` / `isGradientMask`, `LayerEffects`, `BLEND_MODES`, `ExportSettings`, `ProjectManifest`, `AssetEntry`, `Issue`, `hasBox`) | typecheck |
| Catalog | `src/core/catalog.ts`: `ParamDef` (`type`: number, int, boolean, color, enum, stops, curve, rgb; `default`, `min`, `max`, `step`, `options`, `px`), `FILTERS` (`group`, `params`, `example`, `cost`), `COMMON_FILTER_PARAMS` (`enabled`, `amount`), `LOOKS`, `EFFECTS`, `FONTS`, `SIZE_PRESETS`, `MODELS` + `DEFAULT_MODELS`, `LAYER_TYPES`, `SHAPES`, `CATALOG`, lookups `filterDef` / `effectDef` / `fontDef` / `sizePreset` / `modelDef` | `src/core/catalog.test.ts`, `src/engine/filters/registry.test.ts`, `src/studio/i18n/catalog.test.ts` |
| Validation | `src/core/validate.ts` (`validateDoc` never throws, `Collector`, `validatePaint`, `validateFilter`, key lists `ROOT_KEYS`, `COMMON_LAYER_KEYS`, `PLACEMENT_KEYS`, `LAYER_KEYS`, `MAX_CANVAS`, `LARGE_CANVAS_MP`, `normalizeDoc`, `defaultDoc`, `errorsOf`), `suggest.ts` (`closest`, `didYouMean`, `listOptions`), `color.ts` (`parseColor`, `contrastRatio`, `readableTextOn`), `ids.ts` (`ID_RE`, `slugify`, `uniqueId`) | `src/core/validate.test.ts` |
| Paths, files | `src/core/jsonPath.ts` (`parsePath` with `layers#id` refs searching the tree, `getAt`, `setAt`, `removeAt`, `mergePatch`, `stableStringify`, `deepEqual`, `PathError`), `fs.ts` (`ProjectFs`, `MemoryFs`, `FsError`, `normalizePath`), `imageInfo.ts` (header sizes of png / jpeg / webp / gif / bmp / avif / svg, `exifOrientation`), `library.ts` (`LibraryIndex`, `LIBRARY_PREFIX` = `library:`) | `jsonPath.test.ts`, `imageInfo.test.ts` |
| Project | `src/ops/project.ts` (`createProject` — everything that can fail is checked before the first write; `loadProject`, `saveDoc` validates and calls `touchManifest`; `MANIFEST_FILE`, `DOC_FILE`, `ASSET_MANIFEST_FILE`), `templates.ts` (`listTemplates`, `findTemplate`, `parseTemplateInfo`, `instantiateTemplate`), `context.ts` (`OpsError`, `validationError`, `readJson`, `writeJson`, `KB`) | `src/ops/project.test.ts` |
| Document ops | `src/ops/doc.ts` (`getDoc`, `summarizeDoc`, `diffDocs` → `DocPlan`, `applyDoc`, `PatchOp`, `PATCH_OPS`, `GEOMETRY_OPS`, `applyPatchOps`, `sourceSizes`, `patchDoc`), `geometry.ts` (pure: `layerBox`, `estimateTextBox`, `cropDoc`, `resizeCanvasDoc`, `scaleDoc`, `rotateDoc`, `flipDoc`, `ANCHORS`), `tree.ts` (`findLayer`, `walkLayers`, `allLayerIds`, `flattenLayers`, `referencedFiles`, `layerDetail`, `maskKind`) | `src/ops/doc.test.ts` |
| Assets, check, export | `src/ops/assets.ts` (`addAsset`, `addAssetFromUrl` with a `FetchLike`, `listAssets`, `removeAsset`, `missingFiles`, `safeFileName`, `MAX_ASSET_BYTES`), `check.ts` (`checkProject` → `CheckReport`), `export.ts` (`planExport` → `ExportJob`, `IMAGE_FORMATS`, `DEFAULT_QUALITY`, `FORMAT_EXT`) | `src/ops/project.test.ts` ("assets"), `src/ops/check.test.ts` (also `planExport`) |
| Generated docs | `src/ops/docs.ts` (`renderCatalogMarkdown`) → `docs/catalog.md` | `src/ops/docs.test.ts` (`UPDATE_DOCS=1` rewrites) |
| AI tools | `src/ai/tools.ts` (`TOOL_ORDER`, `AI_TOOLS`, `listAiTools`, `findAiTool`, `callAiTool`, `resultImages`), `docTools.ts` (`DOC_TOOLS`, `LAYER_SCHEMA`), `imageTools.ts` (`IMAGE_TOOLS`: render_preview, export, image_analyze, remove_background, mask_generate; `generatedMasks`), `shared.ts` (`checkInput`, `mutationResult`, `compactIssues`, `issueCounts`), `types.ts` (`AiTool`, `ToolContext`, `ToolHost`, `EngineHost`, `EncodedImage`, `SegmentPrompt`, `JsonSchema`) | `src/ai/tools.test.ts` (fake `EngineHost`) |

## Invariants and traps

**Catalog**

- Param `type` drives validation (`validateFilter`), the engine defaults (`withDefaults` in `src/engine/filters/index.ts`), the Studio controls (`src/studio/inspector/ParamField.tsx`) and `docs/catalog.md`. Ranges and enum options are enforced; an unknown param is an `unknown-param` **warning** with "did you mean".
- `px: true` marks a distance in document px: the engine multiplies it by the render scale (previews match exports) and `resizeImage` scales it with the image (`doc.test.ts` "resizeImage scales boxes, text, px params, effects and masks"). A new distance param without `px` renders differently at preview size.
- `cost` (relative cost per megapixel) feeds `check`'s `heavy` info; `SPATIAL_FILTERS` in the engine derives from `group` (`blur`, `detail`) plus `shadowsHighlights` and `pixelate`.
- Parity is tested: every `FILTERS` id has a `FILTER_IMPLS` entry and every look a `LOOK_IMPLS` entry, no extras (`registry.test.ts`); the `look` filter's `look` enum must equal `LOOKS` and `colorOverlay`'s blend options the blend modes (`catalog.test.ts`); every filter, filter group, param name, effect, look, size preset, blend mode and font style needs a label in **both** `src/studio/i18n/en.ts` and `fr.ts` (`src/studio/i18n/catalog.test.ts`). Fonts must exist in `library/index.json` with their woff2 files (`content-internals`).
- Model ids are referenced by `DEFAULT_MODELS`, `remove-bg --model`, `models list|pull|remove` and the Studio AI dialogs; `license` text is shown by `models list` and `docs/catalog.md` (the RMBG-1.4 non-commercial licence must stay visible).

**Validation**

- Every object has an allow-list (`ROOT_KEYS`, `LAYER_KEYS[type]`, canvas and export keys inline in `validateDoc`). A field added to `types.ts` but not to its list is an `unknown-field` **warning** ("ignored"), and `npm run check:skills` rejects any skill document example with warnings.
- Issues carry JSON paths like `layers#title.size` or `layers[2].filters[0].amount`, a message and an actionable hint naming the tool (CLI hints are rewritten to commands by `agent/output.ts`).
- `normalizeDoc` adds structural defaults only (version, missing `layers` → `[]`); it never drops a wrong value. A breaking format change bumps `DOC_VERSION` (copied into `dist/version.json` as `docVersion` by `scripts/write-version.mjs`) and needs a migration in `normalizeDoc`; `validateDoc` rejects any other `version`.

**Document writes**

- `applyDoc` / `patchDoc` never write when the result has errors, the plan is empty (idempotence) or `dryRun`; they return `{ plan, issues, applied }` instead of throwing on invalid documents. `patchDoc` runs ops on a copy (`applyPatchOps` never mutates its input); a failing op throws `OpsError` with `details.opIndex` and the message prefixed `ops[i]:`. All writes go through `saveDoc` (validates, bumps `agentphoto.json` `updatedAt`).
- Geometry ops (`resizeImage`, `rotateCanvas`, `flipCanvas` = `GEOMETRY_OPS`) need the natural size of image sources: `patchDoc` reads them with `sourceSizes` (header parse, `readLibrary` for `library:` ids) unless the caller passes `sizes` (the Studio does). `crop` / `resizeCanvas` / scale / rotate / flip also move canvas-space masks; box-layer masks are layer-local and move with the layer.
- `doc.test.ts` "covers every op of PATCH_OPS in this file": a new op without a test there fails the suite.
- Destructive plans (`doc apply` removing layers, `layer remove`, `assets remove`, export over existing files) are confirmed by the front door (`confirmOrPlan` in the CLI, `DESTRUCTIVE` in MCP annotations), not by ops.

**Assets, check, export, tools**

- Ops are pure TS over `ProjectFs`: no DOM, no Node APIs; network only through the `FetchLike` argument (`addAssetFromUrl`). Tests inject a stub fetch and never touch the network.
- Painted pixels (`assets/edits/`) and AI masks (`assets/masks/`) are always **new** files; source images are never rewritten. `removeAsset` refuses a file a layer still uses unless `force`.
- `check` is `ok` with zero errors; rules: `missing-file`, `unknown-library`, `bad-image`, `off-canvas`, `text-may-overflow`, `upscaled`, `invisible`, `clip-group`, `empty`, `heavy`, plus every validation issue; it also reports licences needing attribution. A new `error` rule must not fire on the shipped templates (instantiate each one and `check` it — `content-internals`).
- `planExport` is pure: format, quality, preset / width / height / scale, fit (`cover` crops, `contain` pads, `stretch`), background (JPEG flattens on white by default), file name; the engine only executes the job.
- `checkInput` validates only `required` + **top-level** types and enums; nested shapes are the handler's (or `validateDoc`'s) job. Schemas may use only the keywords allowed by `checkSchema` in `tools.test.ts`; descriptions must exceed 40 chars. `mutating` drives `mcp --read-only`, MCP `readOnlyHint` and the Studio assistant's confirmation; `needsEngine` hides the tool on hosts without an engine. Mutating tools return `mutationResult` (`status` applied / refused / unchanged / dry-run, plan, counts, compact issues, hint).

## How to add a catalog entry

1. Entry in the right array of `src/core/catalog.ts`: precise `description`, typed `params` with defaults / ranges (`px: true` for distances), `cost`, `example` if useful.
2. Engine implementation in `FILTER_IMPLS` (`src/engine/filters/index.ts`) or `LOOK_IMPLS` (`looks.ts`) — see `pixel-internals`; effects in `src/engine/effects.ts`.
3. Studio labels in `src/studio/i18n/en.ts` and `fr.ts` (`filterNames`, `params`, `lookNames`, `effectNames`, `sizeNames`…).
4. `npx vitest run src/core src/engine/filters src/studio/i18n`.
5. `UPDATE_DOCS=1 npx vitest run src/ops/docs.test.ts` (rewrites `docs/catalog.md`); README / changelog counts (`repo-presentation`).
6. Renaming / removing an id or param: `grep -rn "<id>" plugin/skills docs templates README.md src/studio` and fix every hit; then `npm run hermes:build`.

## How to add a document field

1. `src/core/types.ts`: optional field, additive (contract — report it).
2. `src/core/validate.ts`: add the key to its allow-list and validate it with an actionable hint. Test in `src/core/validate.test.ts`.
3. If it holds a file path: `referencedFiles` in `src/ops/tree.ts` (used by `check`, `assets list`, the engine session's file sync). If it is a distance or a position: the geometry ops in `geometry.ts` (crop, resize, rotate, flip). If it is rendered: the compositor (`pixel-internals`).
4. Studio inspector if editable (`src/studio/inspector/`).
5. Docs: [docs/document-format.md](../../../docs/document-format.md) (prose + example), `plugin/skills/agentphoto-retouch/references/patch-ops.md` or `recipes.md` as relevant, then `npm run hermes:build`.

## How to add a patch op

1. Variant in the `PatchOp` union and name in `PATCH_OPS` (`src/ops/doc.ts`); implementation in `applyPatchOps` using `opError(i, …)` for failures; pure geometry in `geometry.ts`; add it to `GEOMETRY_OPS` if it needs source sizes.
2. Test in `src/ops/doc.test.ts` (mandatory, see above). The `doc_patch` description lists `PATCH_OPS` automatically; document the op's shape there and in `plugin/skills/agentphoto-retouch/references/patch-ops.md`.

## How to add a check rule

1. In `checkProject` (`src/ops/check.ts`) via `add(severity, code, path, message, hint)`, the hint naming the exact fix (tool + CLI form are both fine: the CLI rewrites tool names).
2. Pick severity with care: `error` fails `check` (and the release smoke test runs `check` on a template project).
3. Test in `src/ops/check.test.ts` (MemoryFs project from `createProject`).
4. Mention the new code where agents read check output (`agentphoto-retouch` / `agentphoto-publish` skills) if they must react to it.

## How to add an AI tool

Handler in `DOC_TOOLS` or `IMAGE_TOOLS` calling ops (and `ctx.host.engine` for pixels) only; add its name to `TOOL_ORDER` (`src/ai/tools.ts` throws at import if a name in `TOOL_ORDER` is missing; a tool absent from it is never exposed) and to `READ_ONLY` / `ENGINE` in `tools.test.ts` as relevant; set `mutating` and `needsEngine`. Then the exposure steps in `agent-cli-internals` (MCP annotation sets, `TOOL_COMMANDS`, a CLI command), [docs/mcp.md](../../../docs/mcp.md), the CLAUDE.md "AI tools" list and the skill that uses it.

## Checks before handing over

```bash
npm run typecheck
npx vitest run src/core src/ops src/ai
npx vitest run src/engine/filters src/studio/i18n          # catalog changes
UPDATE_DOCS=1 npx vitest run src/ops/docs.test.ts          # catalog changes, then review the diff
node scripts/build-cli-docs.mjs --check                    # when a command / option changed
npm test
```
