---
name: agentphoto-publish
description: "Export and deliver AgentPhoto images - run the pre-export check, pick the format (PNG, JPEG, WebP; transparency), quality and size (presets for Open Graph, Instagram, stories, YouTube, Pinterest, banners, or exact width / height / scale, cover or contain), export several variants at once, keep files light for the web, name and place outputs, and open the Studio so the user can finish by hand. Use when the user wants to save, export, download, resize for a platform, compress or optimise an image made with AgentPhoto, needs several sizes, or wants to edit it visually themselves."
version: 0.1.2
author: AgentPhoto
license: PolyForm-Noncommercial-1.0.0
platforms: [macos, linux, windows]
metadata:
  hermes:
    tags: [AgentPhoto, Export, Images, Web, Social-media]
    related_skills: [agentphoto-retouch, agentphoto-cutout, agentphoto-design]
---

# Export and share with AgentPhoto

**Language:** talk to the user in their language; keep commands, ids and files in English.

Every command is `python3 ${HERMES_SKILL_DIR}/scripts/agentphoto.py <command> --json` with `--project <dir>`. Read `error.hint` when `ok` is false.

## Running the commands (Hermes)

Every `agentphoto <command>` below runs through this skill's Python wrapper: `python3 ${HERMES_SKILL_DIR}/scripts/agentphoto.py <command> …`. It adds `--json`, prints the CLI's JSON object (`{"ok": true, "data": …}` or `{"ok": false, "error": {code, message, hint}}`) and exits with the CLI's code. In the reference files, `python3 <skill dir>/scripts/agentphoto.py` means the same command with this skill's directory.

- **Requirements:** Python 3.9+ (stdlib only), **Node.js 22+** and, for renders, AI cut-outs and exports, Google Chrome / Chromium / Edge. The AgentPhoto engine is the `@fleox/agentphoto` npm package, fetched by `npx` on first use and pinned to the version of these skills. Without Node.js the wrapper answers `node-missing` with how to install it. `AGENTPHOTO_CMD` overrides the engine command (e.g. `node /path/to/agentphoto/dist/agent/agentphoto.mjs` from a clone); `AGENTPHOTO_CHROME` points at a browser binary.
- **From Python:** `sys.path.insert(0, "${HERMES_SKILL_DIR}/scripts")`, then `from agentphoto import run, patch, needs_confirmation, AgentPhotoError` — `run("analyze", project="my-photo")` returns `data` and raises `AgentPhotoError(code, message, hint, details)` when `ok` is false (validation issues are in `details["issues"]`); `patch(ops, project=…)` sends `doc patch` ops on stdin.
- **Plans:** a command that needs `--yes` and didn't get it writes nothing and answers `needsConfirmation: true` on `data` — test it with `needs_confirmation(data)`. Show the plan to the user before re-running with `--yes`.
- **Looking at renders:** `render` returns absolute PNG paths in `data.files` (with `--compare`: before, then after). Open them with your vision / image tool; if you can't view images, rely on `analyze` and `check` and tell the user you couldn't check the look.
- **Long-running commands** (`studio`, `mcp`) need the user's own terminal: give them the command instead of running it. `studio --project <dir>` opens the visual editor so the user can finish by hand.
- **Helpers** in `${HERMES_SKILL_DIR}/scripts/` (each prints one JSON object; `--help` for options):
  - `export_set.py`: Runs the pre-export `check`, then exports the image once or as a set of platform sizes, and prints every file with its size in KB.
  - `render_and_check.py`: Renders an AgentPhoto project headless (optionally before / after, a zoom or one layer) and runs `check`, then prints the images to look at and a compact verdict.

## 1. Check first

```bash
python3 ${HERMES_SKILL_DIR}/scripts/agentphoto.py check --project my-photo --json
python3 ${HERMES_SKILL_DIR}/scripts/agentphoto.py render --project my-photo --json
```

`check` exits 1 when there are errors (missing files, invalid document). Fix warnings too: `upscaled` (the photo is stretched beyond its resolution: it will look soft; use a smaller output or a larger source), `off-canvas` (a layer is outside the picture), `text-may-overflow` (look at the render). `licences` lists the files whose licence needs a credit: tell the user. Look at the final render once more before exporting.

## 2. Export

```bash
python3 ${HERMES_SKILL_DIR}/scripts/agentphoto.py export --project my-photo --json
python3 ${HERMES_SKILL_DIR}/scripts/agentphoto.py export --project my-photo --format jpeg --quality 85 --width 1600 --json
python3 ${HERMES_SKILL_DIR}/scripts/agentphoto.py export --project my-photo --format webp --quality 80 --out dist/web/hero.webp --json
```

Files go to `<project>/dist/` (`dist/<name>[-<preset or size>].<ext>`; `--name` sets the base name, `--out` an exact path inside the project). The result lists each file with `width`, `height` and `kb`: report them to the user with the absolute `file` path. Exporting over an existing file prints `needsConfirmation` with the plan: ask, then re-run with `--yes`.

| Need | Format |
|---|---|
| Photo for the web, smallest file | `--format webp --quality 80` (≈ 30–50 % smaller than JPEG) |
| Photo for email, print shops, any app | `--format jpeg --quality 85..90` |
| Transparency (cut-out, sticker, logo), flat graphics, text-heavy | `--format png` (or `webp`, which keeps alpha) |
| Social networks | JPEG at the platform preset; they re-compress anyway |

JPEG has no alpha: transparent areas are flattened on white, or on `--background "#0f172a"`. `--background transparent` keeps alpha in PNG / WebP. `avif` is accepted, but Chrome's canvas cannot encode it: the file is written as PNG with a `note` in the result; use WebP.

## 3. Sizes and variants

`--preset` picks a platform size (`python3 ${HERMES_SKILL_DIR}/scripts/agentphoto.py catalog sizes --json`): `og` 1200×630, `square` 1080×1080, `portrait` 1080×1350, `story` 1080×1920, `landscape` 1920×1080, `youtube` 1280×720, `twitter` 1600×900, `pinterest` 1000×1500, `banner` 1920×600, `linkedin-banner` 1584×396, `avatar` 800×800, `product` 2000×2000, `a4` 1240×1754. Or `--width` / `--height` (the other side keeps the aspect) or `--scale 2` (retina).

When the output aspect differs from the canvas, `--fit cover` (default) crops the centre and `--fit contain` pads with `--background`. Several outputs in one call:

```bash
python3 ${HERMES_SKILL_DIR}/scripts/agentphoto.py export --project my-photo --variants '[{"preset":"og","format":"jpeg","quality":85},{"preset":"square","format":"webp","fit":"contain","background":"#0f172a"},{"preset":"twitter","format":"jpeg"}]' --json
```

Read the variants whose aspect changed (a landscape design cropped to `story` loses its sides): if a crop cuts text or a face, design that format separately (copy the project, change the canvas with `doc patch` `resizeCanvas`, move the layers; skill `agentphoto-design`) instead of relying on `cover`.

## 4. Light files for the web

- Width: export at the size it is displayed, ×2 for retina at most (a 800 px wide blog image → `--width 1600`). Never upscale beyond the canvas for the web.
- Targets: hero image < 250 KB, in-article photo < 150 KB, thumbnail < 60 KB, Open Graph < 300 KB (platforms reject > 5 MB).
- Too heavy: lower `--quality` by 5–10 (WebP 75..82 still looks clean), reduce the width, or switch PNG photos to WebP / JPEG. Re-export with `--yes` and compare `kb`.
- Add a `description` to the document (alt text) for accessibility: `doc patch` `[{"op":"set","path":"description","value":"…"}]`.

## 5. The Studio: let the user finish by hand

The Studio is a visual editor (canvas, layers, inspector, filters and looks, masks, AI cut-out, export, an optional assistant) that edits the **same project folder** through a local server on 127.0.0.1. Changes made by the agent in a terminal appear live in it, and changes the user makes are saved to `photo.json`.

```bash
python3 ${HERMES_SKILL_DIR}/scripts/agentphoto.py studio --project my-photo --json
```

It runs until stopped: start it in the background (or ask the user to run it in their own terminal), give them the `url` it prints, and stop it when they are done. `--no-open` doesn't open a browser, `--port <n>` picks the port. After they edit, run `doc summary` before changing anything: the document may have new layers (painted edits are files in `assets/edits/`).

## Rules

- Never overwrite exports without the user's agreement (`needsConfirmation` → ask → `--yes`).
- Report what was written: paths, pixel sizes, KB; offer the other sizes they may need.
- The images stay on the user's computer: AgentPhoto never uploads anything. Publishing them (site, social network) is the user's step, or another tool's.
