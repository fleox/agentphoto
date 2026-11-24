---
name: studio-internals
description: Contributor notes for the AgentPhoto Studio SPA (src/studio/ — App boot and API detection, the Backend interface with RemoteBackend over the CLI REST API vs LocalBackend with in-browser IndexedDB projects and an in-page engine, EditorStore and patch ops, the live renderer and side engine, the viewport tool registry (move, marquee, lasso, magic wand, AI quick select, crop, text, shape, brush, eraser, clone, eyedropper, hand, zoom), painting and selection actions writing new files to assets/edits/ and assets/masks/, inspector panels, the AI download consent, the Claude assistant loop, i18n en / fr, dark-only design tokens), index.html, vite.config.ts (AGENTPHOTO_STUDIO_API proxy, STUDIO_NO_ORT, the ORT alias, library / templates / ort copies), Tailwind / PostCSS, and how `agentphoto studio` serves dist/studio with its API (agent/commands/serve.ts, docs/studio-api.md). Invoke when changing the Studio UI, a tool, a panel, a backend, the Studio API contract, translations, or when screenshotting the Studio in this repository.
---

# AgentPhoto Studio — contributor notes (this repo)

Read [CLAUDE.md](../../../CLAUDE.md) ("Hard rules", "Layout", "Ops") and [AGENTS.md](../../../AGENTS.md) first, then [docs/studio.md](../../../docs/studio.md) (user view) and [docs/studio-api.md](../../../docs/studio-api.md) (the REST contract). Don't commit unless asked. Siblings: [`engine-internals`](../engine-internals/SKILL.md) (ops, validation, AI tools the Studio calls), [`pixel-internals`](../pixel-internals/SKILL.md) (the engine the viewport renders with), [`agent-cli-internals`](../agent-cli-internals/SKILL.md) (`agentphoto studio`, the server side of the API, the model cache proxy), [`content-internals`](../content-internals/SKILL.md) (templates shown on the start screen), [`repo-presentation`](../repo-presentation/SKILL.md) (published Studio screenshots), [`create-mr`](../create-mr/SKILL.md).

## Where things live

| Piece | Source | Notes |
|---|---|---|
| Boot | `src/studio/main.tsx`, `App.tsx` | `detectApi()` (`GET ./api/info`, JSON content-type required) → `RemoteBackend`, else `LocalBackend` (`?project=<local id>` opens one); no project or `?start=1` → `panels/StartScreen.tsx` |
| Editor shell | `src/studio/Editor.tsx` | builds the `EditorStore` whose persist calls `doc_patch` / `doc_apply`; wires the live engine, external changes (SSE / in-browser file events, `events=0` disables), AI tool runs, shortcuts; reads deep-link params via `lib/urlState.ts` (`panel`, `select`, `tool`, `dialog`, `assistant`, `events`, `start`, `project`, `lang`) |
| Backends | `backend/types.ts` (`Backend`, `ToolInfo`, `ToolCallError`, `CreateOptions`, `AiProgress`), `remote.ts` (CLI envelope over `fetch`, `EventSource("./api/events")`, recent folders in `localStorage`), `local.ts` (`PersistedFs` from `idb.ts`, `callAiTool` / `listAiTools` in the page, library / templates / ort next to the Studio), `pageEngine.ts` (`pageEngineHost`: the `EngineHost` in the page) | `modelSource`: `"cli"` (models through the CLI's `/__models/`) or `"hub"` (Hugging Face, after consent) |
| State | `state/editorStore.ts` (framework-free, tested), `context.tsx` (UI store), `tinyStore.ts`, `toolCtx.ts` (`EditorApi` for tools), `shortcuts.ts` | |
| Rendering | `render/liveRenderer.ts` (coalesced on animation frames, latest request wins), `sideEngine.ts` (second `Engine` sharing the loader, own cache: sampling, painting, copies), `painter.ts` (brush / eraser / clone dabs), `masks.ts` (mask planes like the compositor's), `boxes.ts`, `thumbs.tsx` | |
| Tools | `tools/registry.ts` (`TOOLS`, `toolById`, `toolByShortcut`), `types.ts` (`ToolDef`, `ToolId`, drag sessions), one file per tool: `move`, `marquee`, `lasso`, `wand` (magic wand + AI quick select with SAM via `sideEngine().segmentMask`), `crop`, `draw` (text / shape), `paint` (brush, eraser, clone), `view` (hand, zoom, eyedropper), `regionBar.tsx` | |
| Actions | `actions/layer.ts` (rasterize → PNG in `assets/edits/`), `actions/region.ts` (selection → mask / hole / copy / fill / masked adjustment / crop) | files are only ever added |
| Panels | `panels/` — `TopBar.tsx`, `ToolRail.tsx`, `OptionsBar.tsx`, `Viewport.tsx`, `LayersPanel.tsx`, `RightPanel.tsx`, `StatusBar.tsx`, `TextEditor.tsx`, `ExportDialog.tsx`, `AiDialogs.tsx` (one-time model download notice: model, size, licence, source; consent in `localStorage` `agentphoto.studio.modelConsent.<model>`), `ShortcutsDialog.tsx`, `StartScreen.tsx` | |
| Inspector | `inspector/` — `Properties.tsx`, `CanvasSettings.tsx`, `FiltersPanel.tsx`, `LooksPanel.tsx`, `EffectsPanel.tsx`, `MaskSection.tsx`, `FontPicker.tsx`, `ParamField.tsx` (a control from a catalog `ParamDef`) | catalog entries render from their own params |
| UI kit | `components/ui/` — `ColorPicker`, `CurveEditor`, `PaintEditor`, `NumberField`, `Dialog`, `Menu`, `ContextMenu`, `Popover`, `Toast`, `controls` | |
| Pure helpers | `lib/` — `layers.ts` (rows, move / group / nudge ops), `transform.ts` (resize / rotate / snapping), `region.ts`, `selection.ts`, `paint.ts`, `hit.ts`, `labels.ts`, `num.ts`, `download.ts`, `urlState.ts` | tested in `lib/lib.test.ts`, `lib/region.test.ts` |
| Assistant | `assistant/loop.ts` (Messages API tool loop, pure, injected fetch / `callTool` / `readImage`; `MODELS`, `DEFAULT_MODEL`), `AssistantPanel.tsx` | user's own key in `localStorage` `agentphoto.studio.anthropicKey`, sent only to api.anthropic.com |
| i18n | `i18n/en.ts` (source, `Messages`), `fr.ts`, `index.ts` (`t`, `useI18n`, `?lang=`, `agentphoto.studio.lang`) | |
| Styling | `index.css` (CSS variables on `:root`, `color-scheme: dark`), `tailwind.config.js` (`ink-0..4`, `line`, `fg` / `fg-muted` / `fg-faint`, `accent`, `key`, `agent`, `danger`, `warn`; system font stacks; 10–13 px scale), `postcss.config.js` | dark only |
| Build | `index.html`, [vite.config.ts](../../../vite.config.ts) | relative `base`; `closeBundle` copies `library/`, `templates/` (+ generated `templates/index.json`) and the ORT asyncify pair into `dist/studio/`; `STUDIO_NO_ORT=1` (what `npm run build:studio` sets) skips `ort/` because the CLI serves it at `/__engine/ort/`; `build:studio:standalone` keeps it |
| Studio API | `agent/commands/serve.ts` (`startStudioServer`, `localGuard`, `sseHub`), tests `agent/commands/serve.test.ts` | owned by the CLI; contract in `docs/studio-api.md` |

## Invariants and traps

- **The Studio never decides validity.** Every edit becomes `PatchOp`s, applied locally with `applyPatchOps` for instant feedback, then persisted as one debounced `doc_patch` (undo / redo and whole-document edits → `doc_apply`). Live issues come from `validateDoc`; check, export, background removal and masks go through the AI tools (`check`, `export`, `remove_background`, `mask_generate`, `project_create`…). A rule written in a component is a bug: put it in `src/ops/` and call the tool. `EditorStore` coalesces a drag into one undo step and one persisted op (`editorStore.test.ts`), and takes external changes as undoable while ignoring its own echoes.
- **Both backends must behave the same.** `LocalBackend` runs the very same `src/ai/tools.ts` handlers over a `PersistedFs` with `pageEngineHost`, so every tool (pixel tools included) works without Node or Chrome. Differences are declared on the `Backend` (`canCreate()`, `modelSource`, `location`), not guessed from `mode` in components. A new `Backend` method is implemented in **both** `remote.ts` and `local.ts`.
- **Painting and selections are non-destructive.** Brush / eraser / clone, rasterize, "copy to layer" write **new** PNGs in `assets/edits/` (`freePath`), mask painting and AI selections new PNGs in `assets/masks/`; the layer then points at the new file. Never overwrite a file the document or the undo stack may still reference.
- **Coordinates.** Box-layer masks are in layer px (they stretch and move with the layer), fill / group / adjustment masks in canvas px (`lib.test.ts` "masks box layers in layer px and canvas layers in canvas px"). Tool math lives in `lib/transform.ts` / `lib/region.ts`, tested, not in `.tsx`.
- **Live rendering = the engine.** The viewport renders with `src/engine/` in the page (same code as headless Chrome), so what the Studio shows is what `export` writes. A file changed on disk (an agent regenerated a mask) must be invalidated in the loader before the next render, or the per-layer cache shows the old pixels.
- **AI in the page.** Quick select runs Segment Anything in the page (`sideEngine`), background removal runs through `remove_background` (headless Chrome under the CLI, the page in local mode). Under the CLI, models and the ORT WASM come from `/__models/` and `/__engine/ort/` (from `/api/info`: `modelsBase`, `engineBase`); in local mode from the Hub and `./ort/`, only after the consent dialog. Images never leave the computer.
- **The assistant uses the tool catalog, not private calls**: tools from `backend.tools()` (`/api/tools` or `listAiTools()`), results from `backend.call`; render_preview images are attached so the model sees them. A Studio action agents should also have is a new AI tool in `src/ai/`, not Studio code.
- **i18n parity.** `MessageKey` derives from `en.ts`, so a missing en key fails `npm run typecheck`; `i18n/i18n.test.ts` fails on fr key drift or mismatched `{var}` placeholders; `i18n/hardcoded.test.ts` lints `.tsx` for literal JSX text and `title` / `placeholder` / `aria-label` / `label` / `hint` / `alt` strings (extend `ALLOWED` only for technical tokens); `i18n/catalog.test.ts` requires a label in both bundles for every catalog filter, filter group, param, effect, look, size preset, blend mode and font style.
- **Dark only**: no light theme, no `prefers-color-scheme` switch; `index.html` sets `<meta name="color-scheme" content="dark">`. Colours come from the Tailwind tokens, not raw hex.
- **No network** beyond the optional assistant call and the consented model download: no CDN, web fonts or remote images (system font stacks in `tailwind.config.js`; canvas text uses the bundled library fonts).
- **Studio API security** (`serve.ts`): 127.0.0.1 only, `localGuard` rejects a foreign `Host` / `Origin` with 403; after a tool call or a `PUT` / `DELETE` on `/api/project/<path>`, `watcher.ignoreWritten([...])` mutes the echo. A new write route needs the same, the envelope with a `hint`, a `serve.test.ts` case and a `docs/studio-api.md` entry.

## How to add a tool to the rail

1. `tools/<name>.tsx` exporting a `ToolDef` (icon from `lucide-react`, shortcut, cursor, pointer handling returning a drag session, optional overlay and options bar); add it to `TOOLS` and `ToolId`.
2. Document changes as `PatchOp`s through `api.store.edit(ops, { coalesce })`; pixels through `sideEngine(api)`; new files through the backend (`writeFile` / `addImage`) with a free name.
3. Pure geometry in `lib/` with a test; strings and the tool name in both i18n bundles; the shortcut in `ShortcutsDialog` via `shortcuts.ts`.

## How to add an inspector field

1. A catalog param: nothing to do in the Studio beyond its i18n label, it renders from `src/core/catalog.ts` through `ParamField`. A document field outside the catalog: a control in `Properties.tsx` / `CanvasSettings.tsx` / `MaskSection.tsx`, written as a patch op (`updateLayer`, `set`, `setMask`).
2. Labels in `i18n/en.ts` and `fr.ts`.
3. If it is a new `types.ts` field: AGENTS.md "The document format is a contract" (docs, skill references) and `engine-internals`.

## How to add a panel, dialog or deep-link param

1. Component in `panels/`; strings through `t("…")` with keys in both bundles.
2. UI state in `state/context.tsx`; deep-link param parsed in `Editor.tsx` (`initialUi`) and documented in the `lib/urlState.ts` header comment.
3. Data from tools only (`backend.call`), errors as `ToolCallError` (show the `hint`).

## Running and screenshotting

- `npm run dev`: plain Vite on its default port (5173, next free one if busy). The maintainer may already run it: don't kill it, pass `--port <free>` for yours. Without a proxy `/api/info` answers 204 → `LocalBackend` (library, templates and `/ort/` served from the repo). `AGENTPHOTO_STUDIO_API=http://127.0.0.1:<port> npm run dev` proxies `/api`, `/__library`, `/__engine`, `/__models`, `/project` to a running `agentphoto studio`.
- `agentphoto studio [--project <dir>] [--port 4330] [--no-open]` serves `dist/studio` (`studioDir()`, `$AGENTPHOTO_DIST` overrides) with `/__engine/`, `/__library/`, `/project/`, `/__models/`; tries 20 ports from the first. From a clone: `npm run build:studio` (and `build:engine` for pixel tools) first — not while other agents run tests against `dist/`.
- Screenshots: headless Chrome over the DevTools protocol at a fixed viewport (`.github/demos/visuals/shot.mjs <url> <out.png> --size WxH --scale 2`, see its header for `--steps` / `--storage`), deep-link params setting the state (`?select=<id>&panel=filters`, `events=0` to stop the SSE). Published screenshots follow [`repo-presentation`](../repo-presentation/SKILL.md): dark only, nothing personal on screen (no API key in the assistant panel, no `/Users/…` paths).

## Tests

- Studio tests are pure Vitest files in the node environment: `lib/lib.test.ts`, `lib/region.test.ts`, `state/editorStore.test.ts`, `assistant/loop.test.ts`, `i18n/*.test.ts`. No component rendering tests: keep logic out of `.tsx` so it can be tested.
- `vitest.config.ts` (not `vite.config.ts`) runs the tests and excludes `.agentphoto-tmp/**`, `dist/**`, `node_modules/**`.

## Checks before handing over

```bash
npm run typecheck
npx vitest run src/studio agent/commands/serve.test.ts
npm test
# only when no other agent is using dist/:
npm run build:studio
```
