---
name: pixel-internals
description: Contributor notes for the AgentPhoto pixel engine (src/engine/) — the Engine class and its contract (index.ts), the compositor pipeline and its per-layer cache (compositor.ts: content in layer space → filters → mask → transform → effects → clip → opacity + blend), the filter registry and pixel primitives (filters/index.ts FILTER_IMPLS, pixels.ts, looks.ts LOOK_IMPLS, SPATIAL_FILTERS, `px` scaling), layer effects (effects.ts), text layout and bundled fonts as FontFace (text.ts, loader.ts), paints and gradients (paint.ts), image analysis and suggestions (analyze.ts), local AI with transformers.js and ONNX Runtime WebAssembly (ai.ts: RMBG-1.4, MODNet, SlimSAM / SAM, the ORT alias and the asyncify WASM pair), masks as PNG bytes in layer space, the headless entry window.agentphoto (headless.ts) and the engine bundle (vite.engine.config.ts). Invoke when changing how anything is drawn, adding a filter / look / effect implementation, touching fonts, masks, AI models or the engine build, or debugging a render that differs between preview, export, the Studio and headless Chrome in this repository.
---

# Pixel engine — contributor notes (this repo)

Read [CLAUDE.md](../../../CLAUDE.md) ("Hard rules" 1–3 and 5, "Render pipeline", "Engine", "Builds") and [AGENTS.md](../../../AGENTS.md) first. Don't commit unless the user asked in this conversation. `src/engine/index.ts` is a contract (the CLI session, the Studio and the AI tools call it): change it additively and say so in your report. Catalog entries, validation, ops and the AI tools that call the engine: [`engine-internals`](../engine-internals/SKILL.md); how the CLI drives the engine in headless Chrome (session, CDP, model cache proxy): [`agent-cli-internals`](../agent-cli-internals/SKILL.md); the Studio's live renderer, painting and selection tools: [`studio-internals`](../studio-internals/SKILL.md); re-rendering templates and recipes after a look change: [`content-internals`](../content-internals/SKILL.md).

## Where things live

| Piece | File(s) | Notes |
|---|---|---|
| Engine API | [src/engine/index.ts](../../../src/engine/index.ts) | `Engine({ assetBase, libraryBase, library, resolve?, fetchImpl?, ai })` → `render`, `exportImage(doc, job)` (render at `job.scale`, crop / pad source → dest, flatten `job.background`, `encode`), `analyze`, `layerPixels` (a layer's own pixels in layer space, unrotated, no mask / effects / opacity), `backgroundMask`, `segmentMask`, `colorRangeMask` (masks = PNG bytes, grey = alpha, white = keep, + `bbox` via `alphaBBox`), `encode`, `encodeMask`, `bytesToBase64`; re-exports `Compositor`, `FILTER_IMPLS`, `LOOK_IMPLS`, `analyzePixels`, `configureAi`, `layoutText` |
| Compositor | [src/engine/compositor.ts](../../../src/engine/compositor.ts) | `Compositor(loader)`: `render(doc, { scale, background, backdrop, skip, only, onError })`, `layerSurface`, `layerBox` (text measured with the real font), `naturalSize`; per-layer surface cache keyed by `stableStringify(layer)` + scale + file versions (`MAX_CACHE` = 96); `imageBoxSize` |
| Canvas plumbing | [canvas.ts](../../../src/engine/canvas.ts) | `AnyCanvas` (`HTMLCanvasElement` or `OffscreenCanvas`), `Surface { canvas, x, y }`, `MAX_SIDE` = 16384, `createCanvas`, `ctx2d`, `readPixels` / `writePixels`, `compositeOp` (blend mode → `globalCompositeOperation`), `alphaPlane`, `canvasFromAlpha`, `canvasToBlob` |
| Filters | [filters/index.ts](../../../src/engine/filters/index.ts) (`FILTER_IMPLS`, `runFilters`, `FilterEnv { scale }`, `SPATIAL_FILTERS`), [filters/pixels.ts](../../../src/engine/filters/pixels.ts) (`Pixels`, LUTs, `gaussianBlur`, `blurPlane`, `blurAlpha`, `curveLut`, `histogram`, `percentiles`, HSL, sRGB ↔ linear, `mulberry32`), [filters/looks.ts](../../../src/engine/filters/looks.ts) (`LOOK_IMPLS`) | in-place on straight-alpha RGBA |
| Effects | [effects.ts](../../../src/engine/effects.ts) | `applyEffects(surface, fx, scale)` — behind the layer: dropShadow, outerGlow, outside / centre stroke; then the layer with colorOverlay, innerShadow and inside / centre stroke clipped to it; `effectsPad` reserves room around the layer; `dilate` |
| Text, paint | [text.ts](../../../src/engine/text.ts) (`layoutText`, `drawText`, `cssFont`, `backgroundPad`, `roundRect`), [paint.ts](../../../src/engine/paint.ts) (`fillStyle` for colours, linear / radial gradients, `normStops`) | |
| Loading | [loader.ts](../../../src/engine/loader.ts) | `createUrlLoader`: project files under `assetBase` (or `resolve()` for blob URLs), `library:<id>` under `libraryBase`; decodes with `createImageBitmap` (EXIF orientation from the image) and falls back to `<img>` (SVG); fonts as `FontFace` (closest bundled weight / style, latin + latin-ext `unicodeRange`); `invalidate(src)`, `version(src)` |
| Analysis | [analyze.ts](../../../src/engine/analyze.ts) | `analyzePixels` → `ImageStats` (brightness, contrast, range, clipping, saturation, cast, sharpness, dominant colours, `suggestions` = catalog filter objects) |
| Local AI | [ai.ts](../../../src/engine/ai.ts) | `configureAi({ remoteHost, remotePathTemplate, wasmPaths, onProgress })`, `removeBackground(canvas, model)`, `segment(canvas, prompt, model)`, `isModelLoaded`; transformers.js imported lazily on first use |
| Headless entry | [headless.ts](../../../src/engine/headless.ts) | `window.agentphoto` = `init`, `render` (maxWidth / maxHeight / format / backdrop / only), `exportImage`, `analyze`, `backgroundMask`, `segmentMask`, `colorRangeMask`, `invalidate`, `layerBoxes`; JSON in, `{ base64, mime, width, height, bbox?, errors? }` out |
| Build | [vite.engine.config.ts](../../../vite.engine.config.ts) | lib build of `headless.ts` → `dist/engine/agentphoto-engine.js` + `chunks/` (transformers.js) + `ort/` (`copyOrt`); exports `ORT_ALIAS` |

## Invariants and traps

- **The render is a pure function of (document, files, fonts).** No clock, no unseeded randomness: `noise` takes a `seed` and uses `mulberry32` (`registry.test.ts` "noise is deterministic per seed"). The same code runs in the Studio (live, at viewport scale), in headless Chrome (`render`, `export`) and in the Studio's in-browser AI tools (`src/studio/backend/pageEngine.ts`): a difference between them is a bug, not a platform quirk.
- **Pipeline order per layer** (box layers: image, text, shape): content in layer space (image crop + `fit` fill / cover / contain with `focus`, text layout, shape) → `filters` → `mask` (layer-local px, stretched with the box; padding outside the box is hidden) → transform (rotation, flipX / flipY around the box centre) → `effects` (canvas space) → `clip` to the layer below → draw with `opacity` + `blend`. Fill layers and groups render in canvas space and take a canvas-space mask; adjustment layers filter what is already composited below them **inside their group**. Keep `CLAUDE.md` "Render pipeline" in step when you change it.
- **Scale-independence.** Every distance multiplies by the render scale `s`: catalog params with `px: true` through `FilterEnv.scale`, effect blur / distance / spread / stroke width in `effects.ts`, mask feather, shape mask boxes, text sizes. A new distance that ignores `s` makes a 50 % preview disagree with the export.
- **Straight alpha in filters.** Filters mutate un-premultiplied RGBA in place and must keep alpha (the registry test checks every filter and look); blurs weight by alpha so there is no dark halo next to transparency. `runFilters` mixes with the unfiltered pixels by `amount`, except for filters that have their own `amount` param (sharpen, clarity, noise, vignette), where it is the strength. `enabled: false` skips a filter. Defaults come from the catalog (`withDefaults`), so an implementation reads `q.<param>` without re-declaring defaults.
- **Spatial filters** (`SPATIAL_FILTERS`: blur and detail groups, `shadowsHighlights`, `pixelate`) read neighbours and need the whole layer; keep that set right when you add one (it is derived from the catalog `group`).
- **Cache keys.** A layer surface is reused while `stableStringify(layer)`, the scale, the canvas size (fill / group) and the versions of its files are unchanged. Anything new that affects a layer's pixels must be part of the layer JSON or of the key in `cacheKey`, or the Studio shows stale pixels. A file rewritten under the same name needs `loader.invalidate(path)` (the CLI session does it from size + mtime; the Studio on file-change events).
- **Masks** are luminance × alpha planes, white = keep; `invert`, `feather` (× scale), `density` and `enabled` are mask properties applied in `maskPlane`. AI and colour-range masks come back in the layer's own pixel space at up to 2048 px (`layerPixels`), so `mask.src` stretches over the box whatever the source resolution. Segment Anything prompts are given in layer px and scaled to the model input inside `segmentMask`.
- **Fonts.** Only catalog fonts (`FONTS`) bundled in `library/fonts/` are drawn; `preload` loads every text layer's font before composing so measurements (`layerBox`, `layerBoxes`) and pixels use the real metrics. A missing font falls back to `system-ui` silently: check renders after touching `loader.ts` or the library index. No web fonts, ever (hard rule 1).
- **Local AI.** `@huggingface/transformers` is imported only inside `ai.ts` and only on the first AI call, so the engine entry stays small and the CLI bundle never contains it (`vite.agent.config.ts` guard). `rmbg-1.4` needs `model_type: "custom"` and its own processor config (in `session()`); SAM always gets at least one point (the box centre when only a box is given). Models load from `remoteHost` (`/__models/` under the CLI, the Hugging Face Hub in the static Studio after the user agrees), single-threaded when the page is not cross-origin isolated. Images never leave the page.
- **ONNX Runtime WebAssembly.** `ORT_ALIAS` maps `onnxruntime-web/webgpu` to `node_modules/onnxruntime-web/dist/ort.webgpu.min.mjs` so the WASM is not base64-inlined (lib mode would add ~70 MB). That build only ever loads `ort-wasm-simd-threaded.asyncify.{mjs,wasm}`: `copyOrt` copies exactly that pair into `dist/engine/ort/`, and the Studio build (`vite.config.ts`) uses the same alias and the same file pattern. Upgrading transformers.js / onnxruntime-web: check which WASM files the new build requests before changing the pattern. The package size depends on it (commit "Ship only the ONNX Runtime WASM variant in use").
- **Canvas limits.** `MAX_SIDE` / `MAX_CANVAS` are 16384 px; very large canvases are slow and memory-hungry in headless Chrome (`large-canvas` warning above 40 MP, `engine-crashed` when the page runs out of memory).
- **No DOM-only APIs without a fallback**: the engine must work on `OffscreenCanvas` (headless, workers) and `<canvas>`; `Image` is only the decode fallback.

## How to add a filter or a look

1. Catalog entry first (`engine-internals`): params with defaults / ranges, `px: true` on distances, `group`, `cost`, `example`.
2. Implementation in `FILTER_IMPLS` (`filters/index.ts`): `(p: Pixels, q: Params, env: FilterEnv) => void`, in place, alpha untouched, distances × `env.scale`, randomness from `mulberry32(seed)`. Reuse `pixels.ts` primitives (LUTs for per-channel ops are fast). A look is a `LOOK_IMPLS` entry in `looks.ts` (composed of primitives) plus its `LOOKS` entry; the `look` filter dispatches to it.
3. `npx vitest run src/engine/filters` — the registry test runs every filter's `example` and defaults on synthetic pixels, 1 × 1 and fully transparent images, and identity parameters; add a behaviour test under "specific behaviours".
4. Studio labels (en + fr), `docs/catalog.md` (`UPDATE_DOCS=1 npx vitest run src/ops/docs.test.ts`).
5. Render it for real on a library photo (below) and LOOK at it at two scales (`render --max-width 600` and `--zoom`), then compare with `export`.

## How to add or change a layer effect

1. Type in `LayerEffects` (`src/core/types.ts`, additive), catalog `EFFECTS` entry, validation.
2. Drawing in `applyEffects` (behind or in front of the layer), reach in `effectsPad` (an outside effect not covered there gets clipped), every distance × `scale`. Test the pad in `src/engine/pure.test.ts`.
3. `resizeImage` must scale its distances (`src/ops/geometry.ts` `scaleDoc`, test in `src/ops/doc.test.ts`).

## How to add an engine method (pixels an AI tool needs)

`Engine` method in `index.ts` → `window.agentphoto` method in `headless.ts` (JSON / base64 in and out) → `EngineMethod` + `sessionEngineHost` in `agent/render/session.ts` → `EngineHost` in `src/ai/types.ts` (additive) → `pageEngineHost` in `src/studio/backend/pageEngine.ts` → the fake engine in `src/ai/tools.test.ts`. All six or the doors diverge.

## Looking at the result

Unit tests cover pixel maths, not looks. After any visual change, build the engine and render a scratch project from a library photo:

```bash
npm run build:engine && npm run build:agent        # shared dist/ — only when no other agent uses it
node dist/agent/agentphoto.mjs new /tmp/px/look --image library/images/portrait.jpg --json
node dist/agent/agentphoto.mjs filter add photo --type <filter> --project /tmp/px/look --json
node dist/agent/agentphoto.mjs render --project /tmp/px/look --compare --json   # then open the PNGs it lists
```

`agent/e2e.test.ts` (Chrome + `dist/engine`) renders and exports a real project; it skips silently without them. Looks changed (filters, looks, text, effects, compositing)? Re-render the recipes in `plugin/skills/agentphoto-retouch/references/recipes.md`, `docs/images/` and the template previews (AGENTS.md, `content-internals`).

## Checks before handing over

```bash
npm run typecheck
npx vitest run src/engine src/core src/ops/docs.test.ts
npm test
# when imports, the AI path or the build changed, and dist/ is yours to rebuild:
npm run build:engine && ls -la dist/engine dist/engine/chunks dist/engine/ort
npx vitest run agent/e2e.test.ts
```
