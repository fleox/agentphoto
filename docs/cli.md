# The `agentphoto` CLI

```bash
npx -y @fleox/agentphoto@0.1.1 help
npm install -g @fleox/agentphoto      # or install it: the binary is `agentphoto`
```

Node.js 22+ is required. Renders, exports, `analyze` and the AI commands (`remove-bg`, `mask generate`) drive your installed **Google Chrome** (or Chromium / Edge / Brave) headless; `doctor` checks everything.

## Conventions

- **Project**: every command works on a project folder, `--project <dir>` (default: the current directory). A project is `agentphoto.json`, `photo.json` (the document, see [document-format.md](document-format.md)), `assets/` (`images/`, `masks/`, `edits/`, `manifest.json`), `renders/` and `dist/`.
- **`--json`**: prints exactly one object on stdout, `{ "ok": true, "data": … }` or `{ "ok": false, "error": { "code", "message", "hint", "details"? } }`. Progress logs (model downloads, "Exporting 2 files…") go to stderr. Without `--json`, output is human-readable.
- **Exit codes**: 0 success, 1 failure (including `check` with errors and `doctor` with a failed required check), 2 usage or validation error (`doc validate` of an invalid document).
- **Hints**: every error carries an actionable `hint` ("Did you mean "blur"?", the usage line, the next command to run).
- **Plans**: commands that remove or overwrite something (`doc apply` removing layers, `doc patch` with `removeLayer`, `layer remove`, `assets remove`, `models remove`, `export` over existing files) print `{ "needsConfirmation": true, "plan": … }` and write nothing until you add `--yes`.
- **Atomic and validated**: `doc apply`, `doc patch`, `layer …`, `filter …` and `mask …` validate the resulting document and write nothing on errors. `--dry-run` shows the plan without writing.
- **`--set key=value`** (layer / filter): dotted keys, JSON values (`--set size=96`, `--set color=#ffd166`, `--set 'focus=[0.5,0.3]'`, `--set mask=null` removes a field, `--set 'text="Line one\nline two"'` for a line break).
- **Inputs**: `--file <path>` or `-` (stdin) for documents and patches; `--layer`, `--filter`, `--mask`, `--input` take inline JSON or `@file`.

## Environment

| Variable | Effect |
|---|---|
| `AGENTPHOTO_CHROME` | Path of the browser to use for headless renders (default: the installed Chrome, Chromium, Edge or Brave). |
| `AGENTPHOTO_MODELS` | AI model cache folder (default `~/.cache/agentphoto/models`). |
| `AGENTPHOTO_CDP_TIMEOUT_MS` | Timeout of one headless engine call (default 180000; raise it on slow machines or slow model downloads). |
| `AGENTPHOTO_DEBUG` | Print the headless page's console to stderr. |
| `AGENTPHOTO_DIST` | Folder holding the `engine/` and `studio/` builds (default: next to the CLI; for development). |
| `AGENTPHOTO_LIBRARY`, `AGENTPHOTO_TEMPLATES` | Other `library/` and `templates/` folders (tests, custom template sets). |

## Typical session

```bash
npx -y @fleox/agentphoto@0.1.1 new trip --image ./lake.jpg --json
npx -y @fleox/agentphoto@0.1.1 analyze --project trip --json
npx -y @fleox/agentphoto@0.1.1 filter add photo --type shadowsHighlights --set shadows=30 --project trip --json
npx -y @fleox/agentphoto@0.1.1 render --project trip --compare --json      # → renders/preview-before.png + preview.png
npx -y @fleox/agentphoto@0.1.1 check --project trip --json
npx -y @fleox/agentphoto@0.1.1 export --project trip --format webp --quality 82 --json
```

Outputs: `render` writes `renders/preview.png` (and `preview-before.png` with `--compare`) and prints the paths; `export` writes into `dist/` (`dist/<name>[-<preset>|-<w>x<h>].<ext>`) and prints each file with its size in px and KB.

## Command reference

<!-- BEGIN GENERATED: command reference (node scripts/build-cli-docs.mjs) -->

| Command | What it does |
|---|---|
| [`help`](#help) | List commands with their subcommands and options (--json gives a machine-readable list). |
| [`version`](#version) | Print the AgentPhoto version (CLI = engine = skills version). |
| [`doctor`](#doctor) | Check the setup: Node version, installed Chrome (+ version), the engine / Studio builds, library, templates, the AI model cache, and a headless test render. A failed required check makes the command fail (exit 1, error code doctor-failed, one hint per failed check, every check in error.details.checks). |
| [`new`](#new) | Create a project folder (agentphoto.json, photo.json, assets/): from a photo (it becomes the "photo" layer and sets the canvas size), blank (--size preset or --width / --height), and / or from a template (`templates list`). |
| [`info`](#info) | Project overview: manifest, document summary (canvas, layers top → bottom), issue counts, assets and the latest renders / exports. |
| [`doc`](#doc) | Read, replace, patch and validate photo.json (the PhotoDoc). apply / patch are validated (nothing written on errors); removing layers needs --yes. |
| [`layer`](#layer) | List, inspect, add, change, remove and reorder layers (image, text, shape, fill, adjustment, group). |
| [`filter`](#filter) | Non-destructive filters on a layer (or on an adjustment layer — it affects everything below): add, change or remove one. `agentphoto catalog filters` lists them with their parameters. |
| [`mask`](#mask) | Layer masks: set one (image / shape / gradient), clear it, or generate one from pixels with local AI or a colour range (subject, points, box, color) — non-destructive, the mask PNG goes to assets/masks/. |
| [`remove-bg`](#remove-bg) | Remove the background of a photo layer with local AI (nothing is uploaded; the model downloads once): writes a mask to assets/masks/ and sets it on the layer — non-destructive (`mask clear` restores). --background adds a colour / gradient under the cut-out, --shadow a soft drop shadow. |
| [`analyze`](#analyze) | Measure the picture (or one layer's own pixels): brightness, contrast, tonal range, clipping, colour cast, saturation, sharpness, dominant colours — with suggested filters ready for `filter add`. |
| [`render`](#render) | Render the document headless (Chrome) to renders/preview.png and print the image path(s) — LOOK at them after every visual change. --compare also renders the unedited 'before', --layer one layer alone, --zoom a canvas region at 1:1 (mask edges, text). |
| [`export`](#export) | Render the final image(s) into dist/ (headless Chrome): format, quality, size (a preset like og / square / story, or width / height / scale), fit (cover crops, contain pads) and background (flatten transparency). --variants exports several at once. Overwriting existing files needs --yes. |
| [`check`](#check) | Everything to fix before export: validation, missing files, layers off the canvas, upscaled (blurry) photos, text that may overflow, heavy filters, licences needing attribution. Exit 1 when not ok. |
| [`catalog`](#catalog) | What documents can use, with parameters: layerTypes, blendModes, filters, commonFilterParams, looks, effects, shapes, fonts, sizes, models. No section → an overview; a section → its entries; an id → the full entry (params, types, ranges, defaults). |
| [`templates`](#templates) | Starter templates (`agentphoto new <dir> --template <id> [--image <photo>]`): list them, or show one (metadata, files and its document summary). |
| [`assets`](#assets) | Project files (assets/images, masks, edits + manifest with sources and licences): list, add a local image or a URL (optionally as a layer), remove, and browse the built-in library (CC0 sample photos, fonts). |
| [`models`](#models) | Local AI models (background removal, Segment Anything): list them with their cache state, pre-download one (pull — otherwise the first remove-bg / mask generate downloads it), or delete its cache. Cache: ~/.cache/agentphoto/models ($AGENTPHOTO_MODELS overrides). |
| [`studio`](#studio) | Open the Studio (visual editor: canvas, layers, inspector, filters & looks, masks, AI cut-out, export, assistant) on this computer, editing the project folder through a local API (docs/studio-api.md). Runs until stopped (Ctrl+C). |
| [`tools`](#tools) | The AI tool catalog (src/ai/tools.ts) — exactly what the MCP server and the Studio assistant expose: list the tools with their JSON schemas, or call one with a JSON input. |
| [`mcp`](#mcp) | Run the MCP server on stdio (JSON-RPC 2.0, protocol 2025-06-18 / 2025-03-26 / 2024-11-05): tools = the AI catalog (render_preview returns the image), resources = photo://doc, photo://summary, photo://catalog. For Claude Desktop / Claude Code / Cursor. |

Global options (every command): `--json` (Print one JSON object on stdout: { ok, data } or { ok: false, error: { code, message, hint } }), `--help` (Show the command's usage and options instead of running it).

### help

List commands with their subcommands and options (--json gives a machine-readable list).

```
agentphoto help [<command>]
```

### version

Print the AgentPhoto version (CLI = engine = skills version).

```
agentphoto version
```

### doctor

Check the setup: Node version, installed Chrome (+ version), the engine / Studio builds, library, templates, the AI model cache, and a headless test render. A failed required check makes the command fail (exit 1, error code doctor-failed, one hint per failed check, every check in error.details.checks).

```
agentphoto doctor [--no-render]
```

| Option | Description |
|---|---|
| `--no-render` | Skip the test render. |

### new

Create a project folder (agentphoto.json, photo.json, assets/): from a photo (it becomes the "photo" layer and sets the canvas size), blank (--size preset or --width / --height), and / or from a template (`templates list`).

```
agentphoto new <dir> [--image <file|url>] [--size <preset>] [--width <px> --height <px>] [--background <paint>] [--template <id>] [--title <text>] [--force]
```

| Option | Description |
|---|---|
| `--image <value>` | Starting photo: a local file or an http(s) URL (copied into assets/images/). |
| `--size <value>` | Canvas size preset (`agentphoto catalog sizes`: og, square, story, youtube…). |
| `--width <value>` | Canvas width in px. |
| `--height <value>` | Canvas height in px. |
| `--background <value>` | Canvas background: a colour ("#ffffff"), a gradient as JSON, or "transparent". |
| `--template <value>` | Start from this template (`agentphoto templates list`). |
| `--title <value>` | Document title. |
| `--name <value>` | Project name (default: the folder name). |
| `--force` | Overwrite an existing project in the folder. |

_Writes to the project._

### info

Project overview: manifest, document summary (canvas, layers top → bottom), issue counts, assets and the latest renders / exports.

```
agentphoto info [--project <dir>]
```

| Option | Description |
|---|---|
| `--project <value>` | Project folder (default: the current directory). |

### doc

Read, replace, patch and validate photo.json (the PhotoDoc). apply / patch are validated (nothing written on errors); removing layers needs --yes.

```
agentphoto doc <get|summary|apply|patch|validate> [--project <dir>]
```

| Action | Usage | What it does |
|---|---|---|
| `get` | `agentphoto doc get [--path <json.path>]` | The full document, or the value at a path ("canvas", "layers#title.size"). |
| `summary` | `agentphoto doc summary` | Compact outline: canvas, layers top → bottom (id, type, detail, box, opacity, blend, mask, filters, effects), counts, sources. |
| `apply` | `agentphoto doc apply --file <photo.json\|-> [--dry-run] [--yes]` | Replace the whole document (validated). Prints the plan + needsConfirmation when it removes layers, unless --yes. **Plan + `--yes`.** |
| `patch` | `agentphoto doc patch --file <ops.json\|-> [--dry-run] [--yes]` | Apply patch ops atomically ([{ "op": "set", "path": "layers#title.size", "value": 96 }, { "op": "addFilter", "id": "photo", "filter": {…} }, …] — `agentphoto tools list` documents doc_patch). Removing layers needs --yes. |
| `validate` | `agentphoto doc validate [--file <photo.json\|->]` | Validate the project's document (or a candidate file): issues with JSON paths, messages and hints. Exit 2 on errors. |

| Option | Description |
|---|---|
| `--project <value>` | Project folder (default: the current directory). |
| `--file <value>` | Read the JSON input from this file (`-` = stdin). A positional @file / - / inline JSON works too. |
| `--path <value>` | get: a JSON path into the document. |
| `--dry-run` | Compute the plan and the issues, write nothing. |
| `--yes` | Apply — only after the user confirmed the plan. |

### layer

List, inspect, add, change, remove and reorder layers (image, text, shape, fill, adjustment, group).

```
agentphoto layer <list|get|add|update|remove|move> [<id>] [--project <dir>]
```

| Action | Usage | What it does |
|---|---|---|
| `list` | `agentphoto layer list` | Every layer top → bottom (flat, with parent / depth): id, type, detail, box, opacity, blend, mask, filters (their index is what filter update / remove use), effects. |
| `get` | `agentphoto layer get <id>` | One layer's full definition. |
| `add` | `agentphoto layer add --layer <json\|@file> \| --id <id> --type text --text "Hello" [--set k=v …] [--above\|--below <id>] [--parent <group>] [--index <n>]` | Add a layer (validated). Default position: top of the stack. |
| `update` | `agentphoto layer update <id> [--layer <json>] [--set k=v …]` | Change fields of a layer (deep merge; --set effects.dropShadow.blur=24 changes only that key; --set mask=null removes a field). |
| `remove` | `agentphoto layer remove <id> [--yes]` | Remove a layer (and its children for a group); its files stay in assets/. Plan + needsConfirmation unless --yes. **Plan + `--yes`.** |
| `move` | `agentphoto layer move <id> (--above <id> \| --below <id> \| --parent <group> [--index <n>] \| --index <n>)` | Reorder a layer or move it into a group. |

| Option | Description |
|---|---|
| `--project <value>` | Project folder (default: the current directory). |
| `--layer <value>` | add: the layer as JSON (@file, - = stdin); update: the fields to change. |
| `--set <value>` (repeatable) | key=value (dotted keys, JSON values), repeated: --set x=40 --set color="#ff3366" --set effects.dropShadow.blur=24. |
| `--id <value>` | add: the new layer's id ([a-zA-Z][a-zA-Z0-9_-]*). |
| `--type <value>` | add: image, text, shape, fill, adjustment or group. |
| `--text <value>` | add: the text (implies --type text). |
| `--src <value>` | add: image source, "assets/…" or "library:<id>" (implies --type image). |
| `--name <value>` | add: display name. |
| `--above <value>` | add / move: place it just above this layer id. |
| `--below <value>` | add / move: place it just below this layer id. |
| `--parent <value>` | add / move: group id to put it in ("root" = the top level). |
| `--index <value>` | add / move: position in the parent, 0 = bottom (default: top). |
| `--dry-run` | Compute the plan and the issues, write nothing. |
| `--yes` | Apply — only after the user confirmed the plan. |

### filter

Non-destructive filters on a layer (or on an adjustment layer — it affects everything below): add, change or remove one. `agentphoto catalog filters` lists them with their parameters.

```
agentphoto filter <add|update|remove> <layer> [<index>] [--project <dir>]
```

| Action | Usage | What it does |
|---|---|---|
| `add` | `agentphoto filter add <layer> (--filter <json> \| --type <filter> [--set k=v …]) [--index <n>]` | Add a filter, e.g. --type exposure --set exposure=0.3, or --filter '{"type":"look","look":"film"}'. |
| `update` | `agentphoto filter update <layer> <index> (--set k=v … \| --filter <json>)` | Change parameters of the filter at <index> (layer list shows the order). |
| `remove` | `agentphoto filter remove <layer> <index>` | Remove the filter at <index>. |

| Option | Description |
|---|---|
| `--project <value>` | Project folder (default: the current directory). |
| `--filter <value>` | The filter as JSON ({ type, ...params, amount? }), @file or -. |
| `--type <value>` | add: filter type (catalog id). |
| `--set <value>` (repeatable) | Filter parameters as key=value (repeated). |
| `--index <value>` | add: position in the layer's filter list (default: last). |
| `--dry-run` | Compute the plan and the issues, write nothing. |
| `--yes` | Apply — only after the user confirmed the plan. |

### mask

Layer masks: set one (image / shape / gradient), clear it, or generate one from pixels with local AI or a colour range (subject, points, box, color) — non-destructive, the mask PNG goes to assets/masks/.

```
agentphoto mask <set|clear|generate> <layer> [--project <dir>]
```

| Action | Usage | What it does |
|---|---|---|
| `set` | `agentphoto mask set <layer> --mask <json\|@file>` | Set a mask: {"src":"assets/masks/x.png"} \| {"shape":"ellipse","x":0,"y":0,"width":400,"height":300,"feather":20} \| {"gradient":{…}} (+ invert, feather, density, enabled). Box layers: layer-local px. |
| `clear` | `agentphoto mask clear <layer>` | Remove the layer's mask (the file stays in assets/). |
| `generate` | `agentphoto mask generate <layer> --method subject\|points\|box\|color [--points <json>] [--box x1,y1,x2,y2] [--color <c>] [--tolerance <0-100>] [--invert] [--feather <px>] [--model <id>] [--target mask\|copy]` | Make a mask from pixels (needs Chrome; AI models download once): subject (main subject), points (Segment Anything, [[x,y,1\|0],…] in layer px), box, color (colour range). --invert keeps the rest; --target copy masks a duplicate instead. |

| Option | Description |
|---|---|
| `--project <value>` | Project folder (default: the current directory). |
| `--mask <value>` | set: the mask as JSON, @file or -. |
| `--method <value>` | generate: subject, points, box or color. |
| `--points <value>` | generate --method points: [[x, y, 1 = include \| 0 = exclude], …] in layer px. |
| `--box <value>` | generate --method box: x1,y1,x2,y2 in layer px. |
| `--color <value>` | generate --method color: the colour to select. |
| `--tolerance <value>` | generate --method color: 0..100 (default 32). |
| `--invert` | generate: keep everything except the selection. |
| `--feather <value>` | generate: soften the edge, px. |
| `--model <value>` | generate: AI model id (`agentphoto models list`). |
| `--target <value>` | generate: mask (default, the layer itself) or copy (duplicate the layer and mask the copy). |
| `--copy-id <value>` | generate --target copy: id of the copy. |
| `--dry-run` | Compute the plan and the issues, write nothing. |
| `--yes` | Apply — only after the user confirmed the plan. |

### remove-bg

Remove the background of a photo layer with local AI (nothing is uploaded; the model downloads once): writes a mask to assets/masks/ and sets it on the layer — non-destructive (`mask clear` restores). --background adds a colour / gradient under the cut-out, --shadow a soft drop shadow.

```
agentphoto remove-bg <layer> [--model rmbg-1.4|modnet] [--background <paint>] [--shadow] [--feather <px>] [--threshold <0-255>] [--fit x,y,w,h|none] [--anchor center|bottom|…]
```

| Option | Description |
|---|---|
| `--project <value>` | Project folder (default: the current directory). |
| `--model <value>` | rmbg-1.4 (default: products, people, objects) or modnet (portraits). |
| `--background <value>` | Colour or gradient JSON placed behind the subject (adds a fill layer), e.g. "#ffffff". |
| `--shadow` | Add a soft drop shadow under the subject. |
| `--feather <value>` | Soften the edge, px. |
| `--threshold <value>` | Hard edge: keep pixels with confidence ≥ threshold (0..255). Default: soft alpha (best for hair). |
| `--fit <value>` | Scale and move the layer so the subject fits this canvas box "x,y,width,height"; "none" leaves it in place. Default: the template's subject area on its photo slot (first cut-out after `new --template … --image`). |
| `--anchor <value>` | With --fit: where the subject sits in the box — center (default), bottom (on a floor line), top, left, right, top-left… |

_Writes to the project._

### analyze

Measure the picture (or one layer's own pixels): brightness, contrast, tonal range, clipping, colour cast, saturation, sharpness, dominant colours — with suggested filters ready for `filter add`.

```
agentphoto analyze [--layer <id>]
```

| Option | Description |
|---|---|
| `--project <value>` | Project folder (default: the current directory). |
| `--layer <value>` | Analyse this layer alone (default: the whole render). |

### render

Render the document headless (Chrome) to renders/preview.png and print the image path(s) — LOOK at them after every visual change. --compare also renders the unedited 'before', --layer one layer alone, --zoom a canvas region at 1:1 (mask edges, text).

```
agentphoto render [--max-width <px>] [--compare] [--layer <id>] [--zoom x,y,w,h]
```

| Option | Description |
|---|---|
| `--project <value>` | Project folder (default: the current directory). |
| `--max-width <value>` | Preview width cap in px (default 1000). |
| `--compare` | Also render the version without filters / adjustments (before / after). |
| `--layer <value>` | Render only this layer. |
| `--zoom <value>` | Canvas region x,y,width,height rendered at full resolution (max 1600 px). |
| `--backdrop <value>` | Under transparent areas: "checker" (default for transparent canvases and --layer), a CSS colour, or "none". |

### export

Render the final image(s) into dist/ (headless Chrome): format, quality, size (a preset like og / square / story, or width / height / scale), fit (cover crops, contain pads) and background (flatten transparency). --variants exports several at once. Overwriting existing files needs --yes.

```
agentphoto export [--format png|jpeg|webp|avif] [--quality <1-100>] [--preset <size>] [--width <px>] [--height <px>] [--scale <k>] [--fit cover|contain|stretch] [--background <colour>] [--name <file>] [--out <path>] [--variants <json>] [--yes]
```

| Option | Description |
|---|---|
| `--project <value>` | Project folder (default: the current directory). |
| `--format <value>` | png (default), jpeg, webp or avif. |
| `--quality <value>` | 1..100 (jpeg 88, webp 86, avif 70 by default). |
| `--preset <value>` | Size preset (`agentphoto catalog sizes`). |
| `--width <value>` | Output width in px. |
| `--height <value>` | Output height in px. |
| `--scale <value>` | Output scale (2 = twice the canvas). |
| `--fit <value>` | cover (crop, default), contain (pad) or stretch — when the output aspect differs. |
| `--background <value>` | Flatten transparency onto this colour ("transparent" keeps alpha; jpeg defaults to white). |
| `--name <value>` | File name without extension (default: the document id). |
| `--out <value>` | Output path inside the project (default dist/<name>[-<preset>].<ext>). |
| `--variants <value>` | Several outputs: JSON array of { format, preset, width, height, quality, … } (e.g. '[{"preset":"og"},{"preset":"story","format":"webp"}]'). |
| `--yes` | Apply — only after the user confirmed the plan. |

_Writes to the project._

### check

Everything to fix before export: validation, missing files, layers off the canvas, upscaled (blurry) photos, text that may overflow, heavy filters, licences needing attribution. Exit 1 when not ok.

```
agentphoto check [--project <dir>]
```

| Option | Description |
|---|---|
| `--project <value>` | Project folder (default: the current directory). |

### catalog

What documents can use, with parameters: layerTypes, blendModes, filters, commonFilterParams, looks, effects, shapes, fonts, sizes, models. No section → an overview; a section → its entries; an id → the full entry (params, types, ranges, defaults).

```
agentphoto catalog [<section>] [<id>]
```

### templates

Starter templates (`agentphoto new <dir> --template <id> [--image <photo>]`): list them, or show one (metadata, files and its document summary).

```
agentphoto templates <list|show> [<id>] [--category <c>] [--query <text>]
```

| Action | Usage | What it does |
|---|---|---|
| `list` | `agentphoto templates list [--category <c>] [--query <text>]` | Templates with id, category, size, slot (the layer that receives your photo) and description. |
| `show` | `agentphoto templates show <id>` | A template's metadata, files and document summary. |

| Option | Description |
|---|---|
| `--category <value>` | list: social, ad, thumbnail, product, portrait, print, web… |
| `--query <value>` | list: words to look for. |

### assets

Project files (assets/images, masks, edits + manifest with sources and licences): list, add a local image or a URL (optionally as a layer), remove, and browse the built-in library (CC0 sample photos, fonts).

```
agentphoto assets <list|add|remove|library> [--project <dir>]
```

| Action | Usage | What it does |
|---|---|---|
| `list` | `agentphoto assets list` | The project's files with kind, size, source, licence and the layers using them. |
| `add` | `agentphoto assets add (<file> \| --url <url>) [--name <file>] [--license <id>] [--author <name>] [--add-layer [--layer-id <id>]]` | Copy an image into assets/images/ (a URL is downloaded once). --add-layer also adds it as an image layer fitted inside the canvas. |
| `remove` | `agentphoto assets remove <path> [--force] [--yes]` | Delete a project file (plan + needsConfirmation unless --yes; refused while a layer uses it unless --force). **Plan + `--yes`.** |
| `library` | `agentphoto assets library [--kind image\|font] [--query <text>]` | Built-in assets: sample photos (use "library:<id>" as an image src) and fonts (use the id as a text font). |

| Option | Description |
|---|---|
| `--project <value>` | Project folder (default: the current directory). |
| `--url <value>` | add: http(s) URL of an image. |
| `--name <value>` | add: file name to store it as. |
| `--license <value>` | add: the image's licence (e.g. CC0-1.0, proprietary). |
| `--author <value>` | add: author / attribution. |
| `--add-layer` | add: also add it as an image layer. |
| `--layer-id <value>` | add --add-layer: id of the new layer. |
| `--force` | remove: even when layers still use it. |
| `--kind <value>` | library: image or font. |
| `--query <value>` | library: words to look for. |
| `--yes` | Apply — only after the user confirmed the plan. |

### models

Local AI models (background removal, Segment Anything): list them with their cache state, pre-download one (pull — otherwise the first remove-bg / mask generate downloads it), or delete its cache. Cache: ~/.cache/agentphoto/models ($AGENTPHOTO_MODELS overrides).

```
agentphoto models <list|pull|remove> [<id>] [--yes]
```

| Action | Usage | What it does |
|---|---|---|
| `list` | `agentphoto models list` | Every model: id, task, download size, licence, whether it is cached (and its size on disk). |
| `pull` | `agentphoto models pull <id>` | Download a model now by running it once on a sample photo (needs Chrome and the network). |
| `remove` | `agentphoto models remove <id> [--yes]` | Delete a model's cache folder (plan + needsConfirmation unless --yes). **Plan + `--yes`.** |

| Option | Description |
|---|---|
| `--yes` | Apply — only after the user confirmed the plan. |

### studio

Open the Studio (visual editor: canvas, layers, inspector, filters & looks, masks, AI cut-out, export, assistant) on this computer, editing the project folder through a local API (docs/studio-api.md). Runs until stopped (Ctrl+C).

```
agentphoto studio [--port <n>] [--no-open] [--project <dir>]
```

| Option | Description |
|---|---|
| `--project <value>` | Project folder (default: the current directory). |
| `--port <value>` | First port to try (default 4330; 0 = any free port). |
| `--no-open` | Don't open a browser. |

### tools

The AI tool catalog (src/ai/tools.ts) — exactly what the MCP server and the Studio assistant expose: list the tools with their JSON schemas, or call one with a JSON input.

```
agentphoto tools <list|call> [<name>] [--input <json|@file|->] [--project <dir>]
```

| Action | Usage | What it does |
|---|---|---|
| `list` | `agentphoto tools list` | Tools with description, input schema, whether they write and whether they need the engine (Chrome). |
| `call` | `agentphoto tools call <name> --input <json\|@file\|->` | Run one tool against the project. |

| Option | Description |
|---|---|
| `--project <value>` | Project folder (default: the current directory). |
| `--input <value>` | call: the tool input as a JSON object, @file or - (stdin). |

### mcp

Run the MCP server on stdio (JSON-RPC 2.0, protocol 2025-06-18 / 2025-03-26 / 2024-11-05): tools = the AI catalog (render_preview returns the image), resources = photo://doc, photo://summary, photo://catalog. For Claude Desktop / Claude Code / Cursor.

```
agentphoto mcp [--project <dir>] [--read-only]
```

| Option | Description |
|---|---|
| `--project <value>` | Project folder (default: the current directory). |
| `--read-only` | Expose only the tools that don't write. |

<!-- END GENERATED -->
