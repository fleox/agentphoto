# MCP server

`agentphoto mcp` turns a project folder into a [Model Context Protocol](https://modelcontextprotocol.io) server on stdio, so Claude Code, Claude Desktop, Hermes, Cursor or any MCP client can open, retouch, cut out, preview and export images.

```bash
npx -y @fleox/agentphoto@0.1.0 mcp --project /path/to/my-photo [--read-only]
```

- `--project` is the folder the tools work on (it may be empty: the `project_create` tool creates the project there, from a photo, a size preset and / or a template).
- `--read-only` exposes only the tools that don't write.
- Renders, exports and AI masks need Node.js 22+ and Chrome / Chromium / Edge / Brave on the machine running the server (`agentphoto doctor`). One headless Chrome session is started on first use and kept warm.

## Client configuration

**Claude Code**

```bash
claude mcp add agentphoto -- npx -y @fleox/agentphoto@0.1.0 mcp --project /path/to/my-photo
```

Add `--scope project` to share it with a repository (`.mcp.json`). The skills (`/plugin marketplace add fleox/agentphoto`, then `/plugin install agentphoto@agentphoto`) work with or without the MCP server: they drive the CLI.

**Claude Desktop** — `claude_desktop_config.json` (Settings → Developer → Edit config):

```json
{
  "mcpServers": {
    "agentphoto": {
      "command": "npx",
      "args": ["-y", "@fleox/agentphoto@0.1.0", "mcp", "--project", "/Users/me/Pictures/agentphoto/my-photo"]
    }
  }
}
```

Desktop apps may not see your shell's `PATH`: use the absolute path of `npx` (`which npx`) as `command` if the server doesn't start. Several projects = several entries with different names and `--project`.

**Cursor** — `.cursor/mcp.json` (or `~/.cursor/mcp.json`): the same `mcpServers` object as Claude Desktop.

**Hermes Agent** — `~/.hermes/config.yaml`:

```yaml
mcp_servers:
  agentphoto:
    command: npx
    args: ["-y", "@fleox/agentphoto@0.1.0", "mcp", "--project", "/Users/me/Pictures/agentphoto/my-photo"]
```

Or use the Hermes skills in [`hermes/`](../hermes) (Python wrapper of the CLI, no MCP needed).

**Any other client**: run the command above as a stdio server (JSON-RPC 2.0; protocol versions 2025-06-18, 2025-03-26 and 2024-11-05).

## Tools

Exactly the AI tool catalog of `src/ai/tools.ts` (`agentphoto tools list` prints the same list with JSON schemas). Tools marked *engine* run in headless Chrome.

| Tool | Writes | Does |
|---|---|---|
| `project_info` | | Manifest, document summary, issue counts. Start here. |
| `project_create` | yes | Create the project: blank (size preset or width / height), from a photo (path or URL; it becomes the `photo` layer) and / or from a template |
| `doc_summary` | | Compact outline: canvas, layers top → bottom (id, type, box, opacity, blend, mask, filters, effects) |
| `doc_get` | | The full `photo.json` |
| `doc_patch` | yes | Atomic, validated list of ops (`set`, `merge`, `remove`, `addLayer`, `updateLayer`, `removeLayer`, `moveLayer`, `duplicateLayer`, `groupLayers`, `ungroup`, `addFilter`, `updateFilter`, `removeFilter`, `setMask`, `crop`, `resizeCanvas`, `resizeImage`, `rotateCanvas`, `flipCanvas`), `dryRun` |
| `doc_apply` | yes | Replace the whole document (validated) |
| `doc_validate` | | Issues with JSON paths and hints |
| `layer_list`, `layer_add`, `layer_update`, `layer_remove`, `layer_move` | add / update / remove / move | Layers |
| `filter_add` | yes | Add a filter to a layer or an adjustment layer |
| `mask_set` | yes | Set or remove (`null`) an image, shape or gradient mask |
| `remove_background` | yes, *engine* | Local AI cut-out (RMBG-1.4 / MODNet): writes `assets/masks/…`, sets it, optional background and shadow; returns the subject's box |
| `mask_generate` | yes, *engine* | Mask from pixels: `subject`, `points` / `box` (Segment Anything), `color` range; `invert`, `feather`, `target: "copy"` |
| `image_analyze` | *engine* | Brightness, contrast, range, clipping, cast, saturation, sharpness, dominant colours, suggested filters |
| `render_preview` | *engine* | Renders the document and **returns the image** (`compare`, `layer`, `zoom`, `maxWidth`) |
| `catalog_get` | | Filters, looks, effects, blend modes, shapes, fonts, size presets, AI models with parameters |
| `templates_list`, `library_list` | | Starter templates; built-in CC0 photos and fonts |
| `assets_list`, `assets_add`, `assets_remove` | add / remove | Project files with sources and licences; import from a path or a URL |
| `check` | | Everything to fix before export |
| `export` | yes, *engine* | PNG / JPEG / WebP into `dist/`, presets, sizes, fit, variants |

`render_preview` answers with a text block (paths, sizes) **and an `image` block**, so multimodal models see their work. The server's `instructions` tell the model the workflow: summary first, analyze, edit, render and look after every visual change, check, export, and confirm destructive changes with the user.

## Resources

| URI | Content |
|---|---|
| `photo://doc` | The project's `photo.json` |
| `photo://summary` | The compact outline (`doc_summary`) |
| `photo://catalog` | The catalog |

## Without MCP

`agentphoto tools call <name> --input '<json>' --project <dir>` runs any tool from a shell with the same validation, e.g. `npx -y @fleox/agentphoto@0.1.0 tools call doc_summary --input '{}' --project my-photo --json`. The Studio exposes the same list over its local API (`POST /api/tools/call`, [studio-api.md](studio-api.md)).
