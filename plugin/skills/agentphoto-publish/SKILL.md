---
name: agentphoto-publish
description: Export and deliver AgentPhoto images - run the pre-export check, pick the format (PNG, JPEG, WebP; transparency), quality and size (presets for Open Graph, Instagram, stories, YouTube, Pinterest, banners, or exact width / height / scale, cover or contain), export several variants at once, keep files light for the web, name and place outputs, and open the Studio so the user can finish by hand. Use when the user wants to save, export, download, resize for a platform, compress or optimise an image made with AgentPhoto, needs several sizes, or wants to edit it visually themselves.
license: PolyForm-Noncommercial-1.0.0
compatibility: Requires Node.js 22+ and Google Chrome (or Chromium/Edge/Brave) for exports and the Studio.
metadata:
  version: "0.1.0"
  repository: "https://github.com/fleox/agentphoto"
allowed-tools: Bash Read Write
---

# Export and share with AgentPhoto

**Language:** talk to the user in their language; keep commands, ids and files in English.

Every command is `npx -y @fleox/agentphoto@0.1.0 <command> --json` with `--project <dir>`. Read `error.hint` when `ok` is false.

## 1. Check first

```bash
npx -y @fleox/agentphoto@0.1.0 check --project my-photo --json
npx -y @fleox/agentphoto@0.1.0 render --project my-photo --json
```

`check` exits 1 when there are errors (missing files, invalid document). Fix warnings too: `upscaled` (the photo is stretched beyond its resolution: it will look soft; use a smaller output or a larger source), `off-canvas` (a layer is outside the picture), `text-may-overflow` (look at the render). `licences` lists the files whose licence needs a credit: tell the user. Look at the final render once more before exporting.

## 2. Export

```bash
npx -y @fleox/agentphoto@0.1.0 export --project my-photo --json
npx -y @fleox/agentphoto@0.1.0 export --project my-photo --format jpeg --quality 85 --width 1600 --json
npx -y @fleox/agentphoto@0.1.0 export --project my-photo --format webp --quality 80 --out dist/web/hero.webp --json
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

`--preset` picks a platform size (`npx -y @fleox/agentphoto@0.1.0 catalog sizes --json`): `og` 1200×630, `square` 1080×1080, `portrait` 1080×1350, `story` 1080×1920, `landscape` 1920×1080, `youtube` 1280×720, `twitter` 1600×900, `pinterest` 1000×1500, `banner` 1920×600, `linkedin-banner` 1584×396, `avatar` 800×800, `product` 2000×2000, `a4` 1240×1754. Or `--width` / `--height` (the other side keeps the aspect) or `--scale 2` (retina).

When the output aspect differs from the canvas, `--fit cover` (default) crops the centre and `--fit contain` pads with `--background`. Several outputs in one call:

```bash
npx -y @fleox/agentphoto@0.1.0 export --project my-photo --variants '[{"preset":"og","format":"jpeg","quality":85},{"preset":"square","format":"webp","fit":"contain","background":"#0f172a"},{"preset":"twitter","format":"jpeg"}]' --json
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
npx -y @fleox/agentphoto@0.1.0 studio --project my-photo --json
```

It runs until stopped: start it in the background (or ask the user to run it in their own terminal), give them the `url` it prints, and stop it when they are done. `--no-open` doesn't open a browser, `--port <n>` picks the port. After they edit, run `doc summary` before changing anything: the document may have new layers (painted edits are files in `assets/edits/`).

## Rules

- Never overwrite exports without the user's agreement (`needsConfirmation` → ask → `--yes`).
- Report what was written: paths, pixel sizes, KB; offer the other sizes they may need.
- The images stay on the user's computer: AgentPhoto never uploads anything. Publishing them (site, social network) is the user's step, or another tool's.
