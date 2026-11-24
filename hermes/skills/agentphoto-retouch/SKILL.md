---
name: agentphoto-retouch
description: "Retouch a photo with AgentPhoto - open the user's photo as a non-destructive project, measure it (analyze), fix light and colour (exposure, levels, curves, white balance, shadows / highlights, vibrance), apply looks (film, cinema, B&W, golden hour...), retouch portraits (skin smoothing masked to the face, clarity, eyes), crop / straighten / resize, add text, shapes and layer effects, then render and LOOK at the result, check and export. Use when the user wants to edit, enhance, correct, grade, crop or retouch a photo or image file, or change an existing AgentPhoto project (photo.json)."
version: 0.1.1
author: AgentPhoto
license: PolyForm-Noncommercial-1.0.0
platforms: [macos, linux, windows]
metadata:
  hermes:
    tags: [AgentPhoto, Photo, Retouching, Colour, Filters, Image]
    related_skills: [agentphoto-cutout, agentphoto-design, agentphoto-publish]
---

# Retouch a photo with AgentPhoto

A project is a folder: `photo.json` (the document: a stack of layers, bottom to top), `assets/` (imported photos, AI masks), `renders/` (previews) and `dist/` (exports). Every edit is data in `photo.json`: the source photo is never modified, every filter can be changed or removed later.

**Language:** talk to the user in their language; keep commands, ids and files in English.

Every command is `python3 ${HERMES_SKILL_DIR}/scripts/agentphoto.py <command> --json` with `--project <dir>`. Read `error.hint` when `ok` is false. The first command can take a minute (npx install); `doctor` checks Node, Chrome and a test render.

## Running the commands (Hermes)

Every `agentphoto <command>` below runs through this skill's Python wrapper: `python3 ${HERMES_SKILL_DIR}/scripts/agentphoto.py <command> …`. It adds `--json`, prints the CLI's JSON object (`{"ok": true, "data": …}` or `{"ok": false, "error": {code, message, hint}}`) and exits with the CLI's code. In the reference files, `python3 <skill dir>/scripts/agentphoto.py` means the same command with this skill's directory.

- **Requirements:** Python 3.9+ (stdlib only), **Node.js 22+** and, for renders, AI cut-outs and exports, Google Chrome / Chromium / Edge. The AgentPhoto engine is the `@fleox/agentphoto` npm package, fetched by `npx` on first use and pinned to the version of these skills. Without Node.js the wrapper answers `node-missing` with how to install it. `AGENTPHOTO_CMD` overrides the engine command (e.g. `node /path/to/agentphoto/dist/agent/agentphoto.mjs` from a clone); `AGENTPHOTO_CHROME` points at a browser binary.
- **From Python:** `sys.path.insert(0, "${HERMES_SKILL_DIR}/scripts")`, then `from agentphoto import run, patch, needs_confirmation, AgentPhotoError` — `run("analyze", project="my-photo")` returns `data` and raises `AgentPhotoError(code, message, hint, details)` when `ok` is false (validation issues are in `details["issues"]`); `patch(ops, project=…)` sends `doc patch` ops on stdin.
- **Plans:** a command that needs `--yes` and didn't get it writes nothing and answers `needsConfirmation: true` on `data` — test it with `needs_confirmation(data)`. Show the plan to the user before re-running with `--yes`.
- **Looking at renders:** `render` returns absolute PNG paths in `data.files` (with `--compare`: before, then after). Open them with your vision / image tool; if you can't view images, rely on `analyze` and `check` and tell the user you couldn't check the look.
- **Long-running commands** (`studio`, `mcp`) need the user's own terminal: give them the command instead of running it. `studio --project <dir>` opens the visual editor so the user can finish by hand.
- **Helpers** in `${HERMES_SKILL_DIR}/scripts/` (each prints one JSON object; `--help` for options):
  - `open_photo.py`: Opens a photo as an AgentPhoto project in one step (or starts from a template), measures it with `analyze`, optionally applies the suggested corrections as an adjustment layer, and renders a first preview.
  - `render_and_check.py`: Renders an AgentPhoto project headless (optionally before / after, a zoom or one layer) and runs `check`, then prints the images to look at and a compact verdict.

## 1. Open the photo

```bash
python3 ${HERMES_SKILL_DIR}/scripts/agentphoto.py doctor --json
python3 ${HERMES_SKILL_DIR}/scripts/agentphoto.py new my-photo --image ./photo.jpg --json
```

The photo is copied into `my-photo/assets/images/`, becomes the layer `photo` and sets the canvas size. An existing project: start with `info`. Then measure and look:

```bash
python3 ${HERMES_SKILL_DIR}/scripts/agentphoto.py info --project my-photo --json
python3 ${HERMES_SKILL_DIR}/scripts/agentphoto.py analyze --project my-photo --json
python3 ${HERMES_SKILL_DIR}/scripts/agentphoto.py render --project my-photo --json
```

Read the image `render` prints (`data.files[0]`, an absolute path) with your vision / image tool. **Always look before and after each change**: you cannot judge colours, crops or skin from numbers.

`analyze` returns brightness (0..255), contrast, tonal `range`, `clippedShadows` / `clippedHighlights` (%), `saturation`, `cast` (`warm` > 0 = orange, < 0 = blue; `magenta`), `sharpness`, dominant colours and `suggestions` (filters ready to apply). Suggestions are measurements, not orders: a blue lake or a sunset is not a colour cast. Confirm with your eyes.

## 2. Light and colour

Put global corrections in an **adjustment layer** on top: it affects every layer below, stays editable, and one `render --compare` shows before / after.

```bash
python3 ${HERMES_SKILL_DIR}/scripts/agentphoto.py layer add --project my-photo --json --layer '{"id":"correct","type":"adjustment","name":"Correction","filters":[{"type":"levels","black":20,"white":235,"gamma":1.05},{"type":"temperature","temperature":-8},{"type":"vibrance","vibrance":20}]}'
python3 ${HERMES_SKILL_DIR}/scripts/agentphoto.py render --project my-photo --compare --json
```

`--compare` writes `preview-before.png` (no filters, no adjustment layers) and `preview.png`: read both. Then tune one filter by its index (`layer list` shows the order) or add another:

```bash
python3 ${HERMES_SKILL_DIR}/scripts/agentphoto.py filter update correct 0 --set black=28 --set white=228 --project my-photo --json
python3 ${HERMES_SKILL_DIR}/scripts/agentphoto.py filter add correct --type curves --set 'rgb=[[0,0],[64,54],[192,204],[255,255]]' --project my-photo --json
python3 ${HERMES_SKILL_DIR}/scripts/agentphoto.py filter remove correct 2 --project my-photo --json
```

| Problem (what you see / what analyze says) | Filter (real parameters) |
|---|---|
| Too dark / too bright overall | `{"type":"exposure","exposure":0.3}` (stops, -5..5) |
| Flat, hazy (`range` far from 0..255) | `{"type":"levels","black":20,"white":235}` or `{"type":"autoContrast"}` |
| Needs punch in the midtones | `{"type":"curves","rgb":[[0,0],[64,54],[192,204],[255,255]]}` (gentle S) |
| Backlit face, dark shadows, blown sky | `{"type":"shadowsHighlights","shadows":30,"highlights":25}` |
| Orange / blue cast | `{"type":"temperature","temperature":-12}` (negative = cooler), `tint` for green / magenta |
| Dull colours (`saturation` < 20) | `{"type":"vibrance","vibrance":25}` (skin-safe), `hueSaturation` for strong changes |
| Soft | `{"type":"sharpen","amount":60,"radius":1,"threshold":4}` on the photo layer |
| Lacks texture / depth | `{"type":"clarity","amount":15}` |

Every filter takes `amount` (0..1, blend with the unfiltered pixels) and `enabled` (false keeps it but skips it). The full list with ranges and defaults: `python3 ${HERMES_SKILL_DIR}/scripts/agentphoto.py catalog filters --json`, one filter: `catalog filters curves`. Cheat-sheet: [references/filters.md](references/filters.md).

Keep corrections moderate: one strong change looks edited. Stop when the render looks natural.

## 3. Looks

A look is a graded style in one filter (`bw`, `noir`, `sepia`, `vintage`, `polaroid`, `lomo`, `warm`, `cool`, `sunset`, `fade`, `punch`, `cinema`, `cyberpunk`, `cross-process`, `dramatic`, `dreamy`, `matte`, `golden-hour`, `film`, `clean`). Use `amount` 0.5..0.8 for a subtle grade:

```bash
python3 ${HERMES_SKILL_DIR}/scripts/agentphoto.py filter add correct --filter '{"type":"look","look":"film","amount":0.6}' --project my-photo --json
```

Offering options: render each candidate (`filter update correct <index> --set look='"cinema"'`), show the user the images, keep the one they choose.

## 4. Portrait retouch

1. Select the skin on a **copy** of the photo with Segment Anything points in layer pixels (`[x, y, 1]` include, `[x, y, 0]` exclude). Click forehead, both cheeks and chin; exclude eyes and lips. Coordinates come from the full-size canvas: estimate them on the render (`size` vs `canvas` in its output gives the scale).
   ```bash
   python3 ${HERMES_SKILL_DIR}/scripts/agentphoto.py mask generate photo --method points --points '[[768,352,1],[620,640,1],[950,640,1],[784,880,1],[640,496,0],[912,496,0]]' --target copy --copy-id skin --feather 6 --project my-photo --json
   python3 ${HERMES_SKILL_DIR}/scripts/agentphoto.py render --project my-photo --layer skin --json
   ```
   The layer render must show only skin (eyes as holes). Wrong area: run it again with more or other points (it replaces the copy's mask), or use `--method box`.
2. Smooth the copy only (edge-preserving, keeps pores visible at amount < 1):
   ```bash
   python3 ${HERMES_SKILL_DIR}/scripts/agentphoto.py filter add skin --type surfaceBlur --set radius=10 --set threshold=20 --set amount=0.7 --project my-photo --json
   ```
3. Light and pop for the whole picture in the adjustment layer: `shadowsHighlights` (shadows 20..35 opens eye sockets), `clarity` 10..15, `vibrance` 15..20, a slight warm `temperature` if the skin looks grey.
4. Zoom on the face at 1:1 and look: plastic skin means a lower `amount` or `radius`.
   ```bash
   python3 ${HERMES_SKILL_DIR}/scripts/agentphoto.py render --project my-photo --zoom 560,300,480,480 --json
   ```

Never change a face's shape, skin tone or identity beyond what the user asked.

## 5. Crop, straighten, resize

Geometry ops move every layer so the picture stays the same (nothing is rasterised). Straighten first, then crop, then resize:

```bash
python3 ${HERMES_SKILL_DIR}/scripts/agentphoto.py layer update photo --set rotation=-2 --set x=-30 --set y=-20 --set width=1660 --set height=1107 --project my-photo --json
python3 ${HERMES_SKILL_DIR}/scripts/agentphoto.py doc patch --project my-photo --json '[{"op":"crop","x":0,"y":0,"width":1600,"height":900}]'
python3 ${HERMES_SKILL_DIR}/scripts/agentphoto.py doc patch --project my-photo --json '[{"op":"resizeImage","width":1280}]'
```

- Straighten: rotate the photo layer (degrees, clockwise) and enlarge it around its centre so no corner shows (about 3.5 % per degree); render and check the four corners. Do it before making copies of the photo (section 4): a copy keeps its own rotation and box, so apply the same `--set` values to it, or straighten first.
- Crop is in canvas pixels; `resizeImage` scales the whole document (`width`, `height` or `scale`). Other ops: `resizeCanvas` (`width`, `height`, `anchor`: center, top-left…), `rotateCanvas` (`angle` 90 / 180 / 270), `flipCanvas` (`axis` horizontal / vertical).
- A social format is often better done at export (`--preset square --fit cover`, skill `agentphoto-publish`).

All patch ops, paths and shortcuts: [references/patch-ops.md](references/patch-ops.md).

## 6. Text, shapes, effects

```bash
python3 ${HERMES_SKILL_DIR}/scripts/agentphoto.py layer add --layer '{"id":"band","type":"shape","shape":"rect","x":0,"y":560,"width":1280,"height":160,"fill":{"type":"linear","angle":90,"stops":["rgba(0,0,0,0)","rgba(0,0,0,0.55)"]}}' --project my-photo --json
python3 ${HERMES_SKILL_DIR}/scripts/agentphoto.py layer add --id caption --text "Summer 2026" --set x=48 --set y=610 --set font=playfair --set size=64 --set color=#ffffff --project my-photo --json
python3 ${HERMES_SKILL_DIR}/scripts/agentphoto.py layer update caption --set effects.dropShadow.blur=18 --set effects.dropShadow.opacity=0.45 --project my-photo --json
```

Fonts are bundled (`catalog fonts`); effects: `dropShadow`, `outerGlow`, `innerShadow`, `stroke`, `colorOverlay` (`catalog effects`). Layout rules and typography: skill `agentphoto-design`.

## 7. Check and export

```bash
python3 ${HERMES_SKILL_DIR}/scripts/agentphoto.py check --project my-photo --json
python3 ${HERMES_SKILL_DIR}/scripts/agentphoto.py export --project my-photo --format jpeg --quality 88 --json
```

`check` must report no errors (missing files, invalid filters) and you should fix warnings (upscaled photo, layer off the canvas). The export lands in `my-photo/dist/`. Give the user the path; formats, sizes and variants: skill `agentphoto-publish`.

Complete, validated documents for common jobs (colour correction, portrait, B&W, background blur, caption): [references/recipes.md](references/recipes.md).

## Rules

- Render and look after every visual change; describe what you see, not what you hoped.
- Prefer adjustment layers and filters over anything destructive; never edit `assets/` files by hand.
- Plans with `needsConfirmation: true` wrote nothing: tell the user what will be removed or overwritten, and re-run with `--yes` only after they agree.
- Patches are atomic and validated: on `ok: false` nothing was written. Read the error's `hint` ("did you mean") and fix the op.
- The user's photos stay on their computer: AgentPhoto uploads nothing. AI models download once (tell the user the first cut-out can take a minute).
