# Studio API

`agentphoto studio [--project <dir>] [--port 4330] [--no-open]` serves the Studio
SPA (`dist/studio/`) and a small REST API on **127.0.0.1 only**. The Studio uses it
to edit a project folder on disk; any local script can use it too.

Every request must come from this server: a `Host` header other than
`127.0.0.1:<port>`, `localhost:<port>` or `[::1]:<port>`, or an `Origin` from
another site, is refused with **403** (DNS rebinding, cross-site writes).

## Responses

JSON routes answer `{ "ok": true, "data": … }` or
`{ "ok": false, "error": { "code", "message", "hint"?, "details"? } }` with an HTTP
status: 400 (bad input / invalid path / validation), 404 (`notFound`, `no-project`),
500 (anything else). AI-tool hints name tools (`layer_list`), not CLI commands.

## Static mounts

| Path | Serves |
|---|---|
| `/project/<path>` | the project folder (what the engine loads: `assets/…`) |
| `/__library/<path>` | `library/` (fonts, sample photos, `index.json`) |
| `/__engine/<path>` | `dist/engine/` (`agentphoto-engine.js`, `chunks/`, `ort/*.wasm` as `application/wasm`, `*.mjs` as `text/javascript`) |
| `/__models/<repo>/resolve/<rev>/<file>` | the AI model cache proxy (below) |
| anything else | `dist/studio/` (unknown paths without an extension → `index.html`) |

## Routes

| Method & path | Body | Answer `data` |
|---|---|---|
| `GET /api/info` | — | `{ version, project: { dir, manifest \| null, exists } \| null, assetBase: "/project/", libraryBase: "/__library/", engineBase: "/__engine/", modelsBase: "/__models/" }` — `exists` is false until `photo.json` exists (create it with `project_create`). |
| `GET /api/catalog` | — | the catalog (`src/core/catalog.ts` `CATALOG`): layer types, filters, looks, effects, blend modes, shapes, fonts, sizes, models. |
| `GET /api/library` | — | `library/index.json` (`{ assets }`). |
| `GET /api/templates` | — | `{ templates: TemplateInfo[] }` (`templates/<id>/template.json`). |
| `GET /api/templates/:id/preview.jpg` | — | the template's preview image (raw bytes; 404 when the template has none). |
| `GET /api/tools` | — | `{ tools: [{ name, description, inputSchema, mutating, needsEngine }] }` — exactly the MCP / `agentphoto tools list` catalog. |
| `POST /api/tools/call` | `{ "name": "<tool>", "input": { … } }` | the tool's result. Pixel tools (`render_preview`, `export`, `image_analyze`, `remove_background`, `mask_generate`) run in the server's headless Chrome, started on first use and kept warm. Files the tool writes are not echoed on `/api/events`. |
| `GET /api/events` | — | Server-Sent Events: `event: change` with `data: { "paths": [...] }` when project files change on disk outside the API (another editor, the CLI, an agent). `renders/`, `dist/`, `.git` and `node_modules` are ignored. |
| `GET /api/project?prefix=<dir/>` | — | `{ files: [{ path, size }] }` — project files, recursively. |
| `GET /api/project/<path>` | — | the file's bytes (`HEAD` too). |
| `PUT /api/project/<path>` | raw bytes | `{ path, bytes }` — creates folders; the Studio writes painted edits to `assets/edits/` this way. |
| `DELETE /api/project/<path>` | — | `{ removed }` (404 when missing). |

Project paths are relative to the project folder; `..`, absolute paths and
symlinks leaving the folder are refused (400).

## Model cache proxy

`GET /__models/<repo>/resolve/<rev>/<file>` (transformers.js `remoteHost` =
`<origin>/__models/`) serves `~/.cache/agentphoto/models/<repo>/<rev>/<file>`
(`AGENTPHOTO_MODELS` overrides the folder). A file not cached yet is downloaded
once from `https://huggingface.co/<repo>/resolve/<rev>/<file>`, streamed to the
page while it is written to a temporary file renamed when complete. Upstream 404s
pass through and are not cached. `agentphoto models list|pull|remove` manage the
cache.
