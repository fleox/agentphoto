---
name: agentphoto-cutout
description: Remove the background of a photo and work with masks in AgentPhoto, with local AI (nothing is uploaded) - cut out a person, a product or a pet, put it on white, a brand colour, a gradient or another photo, recentre and resize the subject, select an object with Segment Anything points or a box, select a colour range (sky, backdrop), invert, feather and refine edges by zooming the render, blur or recolour only the background, make transparent PNG stickers with an outline. Use when the user asks to remove or replace a background, cut out / isolate / extract a subject, make a packshot or product photo on white, a transparent PNG, a sticker, or a mask.
license: PolyForm-Noncommercial-1.0.0
compatibility: Requires Node.js 22+ and Google Chrome (or Chromium/Edge/Brave). AI models (25-170 MB) download once into ~/.cache/agentphoto/models.
metadata:
  version: "0.1.2"
  repository: "https://github.com/fleox/agentphoto"
allowed-tools: Bash Read Write
---

# Cut-outs and masks with AgentPhoto

Background removal and AI masks run **on this computer** in the user's Chrome (ONNX models via transformers.js). The photo is never uploaded. The first use of a model downloads it once (RMBG-1.4 168 MB, MODNet 25 MB, SlimSAM 30 MB) into `~/.cache/agentphoto/models`: tell the user it can take a minute the first time.

A cut-out is **non-destructive**: the AI writes a mask PNG to `assets/masks/` and sets it on the layer (white = keep). `mask clear` restores the original.

**Language:** talk to the user in their language; keep commands, ids and files in English.

Every command is `npx -y @fleox/agentphoto@0.1.2 <command> --json` with `--project <dir>`. Read `error.hint` when `ok` is false. Basics (projects, render, filters): skill `agentphoto-retouch`.

## 1. Remove the background

```bash
npx -y @fleox/agentphoto@0.1.2 new my-photo --image ./photo.jpg --json
npx -y @fleox/agentphoto@0.1.2 remove-bg photo --project my-photo --json
npx -y @fleox/agentphoto@0.1.2 render --project my-photo --json
```

- Models: `rmbg-1.4` (default: products, people, animals, objects) or `--model modnet` (portraits only, soft hair). `models list` shows what is cached.
- `data.subject` is the kept area in canvas px `{ x, y, width, height }` (null = nothing found): use it to recentre, rescale and crop.
- Recentre and rescale the cut-out in one op: `fitLayer` scales the layer (uniformly) and moves it so `subject` fits `box` (canvas px), aligned on `anchor` (`center`, `bottom` = standing on a floor line, `top`, `left`…). Example on a 1600×900 canvas with a 10 % margin:
  ```bash
  npx -y @fleox/agentphoto@0.1.2 doc patch --project my-photo --json '[{"op":"fitLayer","id":"photo","subject":{"x":881,"y":306,"width":475,"height":329},"box":{"x":160,"y":90,"width":1280,"height":720},"anchor":"center"}]'
  ```
  Or let `remove-bg` do it: `--fit x,y,width,height --anchor bottom`. Scaling a small subject up a lot gives an `upscaled` warning in `check`: the source has too few pixels for that size.
- `--threshold 128` gives a hard edge (products with clean outlines); the default soft alpha is best for hair and fur. `--feather 2` softens a jagged edge.
- An empty canvas shows as transparent (white in the preview): export PNG or WebP to keep the transparency.

`remove-bg` is licensed differently per model: RMBG-1.4 is **non-commercial** (bria-rmbg-1.4 licence); for commercial work use `--model modnet` (Apache-2.0) on people, or SAM masks (`mask generate --method box`, Apache-2.0).

## 2. Replace the background

On a colour or gradient, with a soft drop shadow, in one command:

```bash
npx -y @fleox/agentphoto@0.1.2 remove-bg photo --background "#ffffff" --shadow --project my-photo --json
```

It adds a fill layer `photo-background` under the subject. Change it later like any layer:

```bash
npx -y @fleox/agentphoto@0.1.2 layer update photo-background --set 'fill={"type":"radial","stops":["#ffffff","#e8edf3"]}' --project my-photo --json
```

On another photo: import it as a layer and move it under the subject, then match the light (`temperature`, `exposure` on the subject) so it does not look pasted:

```bash
npx -y @fleox/agentphoto@0.1.2 assets add ./beach.jpg --license proprietary --add-layer --layer-id backdrop --project my-photo --json
npx -y @fleox/agentphoto@0.1.2 layer move backdrop --below photo --project my-photo --json
npx -y @fleox/agentphoto@0.1.2 filter add backdrop --type blur --set radius=6 --project my-photo --json
```

A slight blur on the new background sells the depth. The built-in CC0 photos (`assets library --kind image`) work as `"src": "library:<id>"`.

## 3. Product on white (packshot)

1. `remove-bg photo --background "#ffffff" --shadow --threshold 128` (clean edge).
2. Crop a square around `data.subject` with about 15 % margin on each side: side = max(width, height) / 0.7, centred on the subject. Example for `subject` = `{ "x": 881, "y": 306, "width": 475, "height": 329 }`:
   ```bash
   npx -y @fleox/agentphoto@0.1.2 doc patch --project my-photo --json '[{"op":"crop","x":769,"y":121,"width":700,"height":700}]'
   ```
3. Tune the shadow so it reads as contact, not as a halo: `layer update photo --set effects.dropShadow.opacity=0.28 --set effects.dropShadow.distance=14 --set effects.dropShadow.blur=22`.
4. Render, zoom on the edges, `check`, then export at the size the shop wants (`export --format jpeg --width 2000`, skill `agentphoto-publish`). The template `product-white` (`new shop --template product-white --image ./mug.jpg`) gives a ready backdrop and floor shadow: run `remove-bg photo` on it — the first cut-out of your photo also scales the product and stands it on the floor shadow (`data.fitted` says where; `--fit none` keeps the layer where it is).

## 4. Check and refine the edge

Always zoom on difficult edges (hair, fur, fingers, transparent glass, the handle of a mug) at 1:1:

```bash
npx -y @fleox/agentphoto@0.1.2 render --project my-photo --zoom 420,220,200,200 --json
npx -y @fleox/agentphoto@0.1.2 render --project my-photo --layer photo --json
```

| What you see | Fix |
|---|---|
| Background left in a hole (inside a handle, between arms) | `mask generate photo --method points` with a `0` point in the hole, or `--threshold` |
| Part of the subject missing | `mask generate photo --method box` around the subject (Segment Anything), or `--model modnet` for people |
| Halo of the old background | `--threshold 160`, or a `feather` of 1..2, or a dark / light `stroke` effect hiding it |
| Hard, jagged edge | `remove-bg photo --feather 2` (soft alpha is the default) |

## 5. Masks from points, a box or a colour

`mask generate` makes a mask from pixels. Coordinates are **layer pixels** (from the layer's top-left, before rotation; for a full-canvas photo that is canvas px). `--target copy` duplicates the layer and masks the copy (the original stays whole), `--invert` keeps everything except the selection.

```bash
npx -y @fleox/agentphoto@0.1.2 mask generate photo --method points --points '[[700,420,1],[760,600,1],[1200,200,0]]' --target copy --copy-id subject --project my-photo --json
npx -y @fleox/agentphoto@0.1.2 mask generate photo --method box --box 400,200,1200,900 --target copy --copy-id boxed --project my-photo --json
npx -y @fleox/agentphoto@0.1.2 mask generate photo --method color --color "#579bd6" --tolerance 25 --target copy --copy-id sky --project my-photo --json
npx -y @fleox/agentphoto@0.1.2 mask generate photo --method subject --invert --feather 20 --target copy --copy-id bg --project my-photo --json
```

Then change only that region with filters on the copy:

- **Background blur (portrait mode)**: the `bg` copy (subject inverted) + `filter add bg --type blur --set radius=14`.
- **Bluer sky**: the `sky` copy (colour range) + `filter add sky --type hueSaturation --set saturation=25 --set lightness=-10`.
- **Black-and-white background, colour subject**: the `bg` copy + `filter add bg --type grayscale`.

Pick colours for `--method color` from `analyze` (`dominant`). Points: `1` = include, `0` = exclude; three to five well-spread points beat one. Render the copy alone (`render --layer <copy-id>`) to judge the selection.

Hand-made masks (no AI) with `mask set`: an ellipse or rect with `feather` (vignette, spotlight), or a gradient (fade a photo into a panel):

```bash
npx -y @fleox/agentphoto@0.1.2 mask set photo --mask '{"shape":"ellipse","x":200,"y":100,"width":1200,"height":860,"feather":120}' --project my-photo --json
npx -y @fleox/agentphoto@0.1.2 mask set photo --mask '{"gradient":{"type":"linear","angle":0,"stops":["black","white"]}}' --project my-photo --json
npx -y @fleox/agentphoto@0.1.2 mask clear photo --project my-photo --json
```

A mask object also takes `invert`, `feather` (px), `density` (0..1: how much it hides) and `enabled`. Shape and gradient masks on image / text / shape layers are in layer pixels.

## 6. Sticker (transparent PNG with an outline)

```bash
npx -y @fleox/agentphoto@0.1.2 remove-bg photo --threshold 128 --project my-photo --json
npx -y @fleox/agentphoto@0.1.2 layer update photo --set effects.stroke.color=#ffffff --set effects.stroke.width=14 --set effects.dropShadow.opacity=0.35 --set effects.dropShadow.blur=12 --project my-photo --json
npx -y @fleox/agentphoto@0.1.2 export --project my-photo --format png --background transparent --json
```

The stroke follows the mask's outline (`position`: outside by default). Crop around `data.subject` first so the sticker has no empty margin (leave room for the stroke: + 2 × width).

## Rules

- Render and look after every mask: an AI mask is a guess. Zoom on the edges before saying it is done.
- Masks are files in `assets/masks/`; never edit or delete them by hand (`assets list` shows which layer uses each).
- Re-running `remove-bg` or `mask generate` on the same layer replaces its mask; the old PNG stays in `assets/masks/`.
- Keep the photo's original pixels: never "bake" a cut-out; the user can always `mask clear`.
- JPEG has no transparency: transparent results go out as PNG or WebP.
