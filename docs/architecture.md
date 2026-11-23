# Architecture

AgentPhoto is a photo studio with **no server of its own**. Four front doors share one engine; the engine works on a project folder; the output is ordinary image files.

```text
  Studio (React SPA)    agentphoto CLI    MCP server (stdio)    Studio assistant
          \                  |                   |                    /
           +----------- src/ai/tools.ts — the AI tool catalog ------+
           |                                                         |
           +------------ src/ops/ — business rules (pure TS) --------+
           |  project · doc (summary, diff, apply, patch ops) · geometry (crop, resize,
           |  rotate, flip) · tree · assets · check · export plan · templates
           +------------ ProjectFs (node:fs / Studio API / memory) --+
                                      |
            agentphoto.json · photo.json · assets/ (images, masks, edits) · renders/ · dist/
                                      |
           src/engine/ — pixels (Canvas 2D in the browser / headless Chrome)
           compositor · filters + looks · text · effects · analyze · AI (transformers.js)
```

## Layers

- `src/core/` — the contracts: `types.ts` (PhotoDoc, [the format](document-format.md)), `catalog.ts` (filters with parameters, looks, layer effects, blend modes, shapes, fonts, size presets, AI models — declared once), `validate.ts` (structural + catalog validation with "did you mean"), `fs.ts` (`ProjectFs` + `MemoryFs`), JSON paths, ids, colours, image header sizes, the library index.
- `src/ops/` — every business rule as pure functions over a `ProjectFs`: no DOM, no Node APIs, network only through an injected `fetch`. Geometry ops move and scale layers so the picture stays the same (nothing is rasterised). Errors are `OpsError(code, message, hint, details)`.
- `src/engine/` — pixels: the compositor turns a PhotoDoc into a canvas (layers, boxes, crop / fit, masks, blend modes, clipping, groups, adjustment layers), the filter registry (one implementation per catalog filter; a test fails when one is missing), looks, text with the bundled fonts, layer effects, `analyze`, and the AI (`ai.ts`: RMBG-1.4, MODNet and Segment Anything through transformers.js and ONNX Runtime WebAssembly). `headless.ts` exposes it as `window.agentphoto` for headless Chrome. Built to `dist/engine/`.
- `src/ai/` — the AI tool catalog (name, description, JSON schema, `mutating`, `needsEngine`, handler). MCP `tools/list`, `agentphoto tools list|call`, the Studio API and the assistant expose exactly this list.
- `src/studio/` — the visual editor ([studio.md](studio.md)).
- `agent/` — the CLI (`agentphoto`, bundled to `dist/agent/agentphoto.mjs` with every dependency inlined): commands, the MCP server (JSON-RPC by hand), the headless host (`agent/render/`), the Studio server, the Node `ProjectFs`.
- `library/` and `templates/` — bundled fonts (OFL / Apache-2.0), CC0 sample photos and starter projects, shipped in the npm package.
- `plugin/skills/` — the agent skills (single source).

## The render loop

`agentphoto render` → a local HTTP server on 127.0.0.1 (`/__engine/`, `/__library/`, `/project/`, `/__models/`) → the user's installed Chrome, headless with a temporary profile, driven by a hand-written DevTools-protocol client (no puppeteer) → the page imports the engine, which loads the document's files and fonts, composites and returns PNG bytes → `renders/preview.png`. `--compare` also renders the document without filters and adjustment layers; `--layer` renders one layer; `--zoom` renders a canvas region at 1:1. Exports, `analyze` and the AI masks go through the same session; one Chrome is reused per process (the MCP and Studio servers keep it warm).

The render is a pure function of (document, files, fonts): an agent edits the JSON, renders, **looks** at the PNG, fixes, and the export is the same picture.

## AI models

Background removal and segmentation run in that same headless page (or in the Studio's page). Model files are fetched through `/__models/`, which serves `~/.cache/agentphoto/models` and downloads a missing file once from Hugging Face. After that, cut-outs work offline. `agentphoto models list|pull|remove` manage the cache.

## Why no server

Photos are personal. Every step — editing, previews, AI, exports — runs on the user's computer, in their own browser engine. There is no AgentPhoto account, service or telemetry; the only network use is the one-time model download and, if the user asks, importing an image from a URL. See [security.md](security.md).
