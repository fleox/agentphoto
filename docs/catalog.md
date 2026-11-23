# AgentPhoto catalog

<!-- Generated from src/core/catalog.ts by renderCatalogMarkdown() (src/ops/docs.ts). Do not edit by hand. -->

Everything a document (`photo.json`) can reference by id. Agents: query it with the `catalog_get` tool or `agentphoto catalog [section] [id]`.

## Contents

- [Layer types](#layer-types) (6)
- [Blend modes](#blend-modes) (16)
- [Filters](#filters) (28)
- [Looks](#looks) (20)
- [Layer effects](#layer-effects) (5)
- [Shapes](#shapes) (5)
- [Fonts](#fonts) (15)
- [Size presets](#size-presets) (13)
- [AI models](#ai-models) (4)

## Layer types

Layers are listed bottom → top in `layers`; every layer has `id`, `type`, and optionally `name`, `visible`, `locked`, `opacity` (0 … 1), `blend`, `mask`, `clip`, `filters`, `effects`.

| Type | Description |
|---|---|
| `image` | A photo / bitmap from the project (assets/…) or the library (library:<id>), placed in a box (x, y, width, height, rotation, flip), optionally cropped (crop) and fitted (fit: fill \| cover \| contain). |
| `text` | Live text: text, font (catalog id), size, weight, italic, color (colour or gradient), align, valign, lineHeight, letterSpacing, transform, width (wrap), background (label box). |
| `shape` | Vector shape: shape rect \| ellipse \| line \| polygon \| star, fill (colour or gradient, null = none), stroke {color, width, dash}, radius, sides, innerRadius. |
| `fill` | Solid colour or gradient covering the canvas (backgrounds, colour washes; use a mask to shape it). |
| `adjustment` | Applies its filters to everything below it (inside its group) — non-destructive global corrections. |
| `group` | Groups layers (children, bottom → top): opacity, blend, mask and filters apply to the group as a whole. |

## Blend modes

Layer `blend` (and `colorOverlay.blend`):

`normal`, `multiply`, `screen`, `overlay`, `darken`, `lighten`, `color-dodge`, `color-burn`, `hard-light`, `soft-light`, `difference`, `exclusion`, `hue`, `saturation`, `color`, `luminosity`

## Filters

Non-destructive, in order: `filters: [{ "type": "<id>", …params }]` on any layer, or on an `adjustment` layer to affect everything below it. Parameters marked _(px)_ scale with the render so previews match exports.

Every filter also accepts:

| Param | Type | Default | Range | Description |
|---|---|---|---|---|
| `enabled` | boolean | `true` |  | false = keep the filter but skip it. |
| `amount` | number | `1` | 0 … 1 | Blend with the unfiltered pixels, 0 … 1. |

### Light

#### `brightnessContrast` — Brightness / Contrast

Lighten or darken the image and increase or reduce contrast. _Cost: 1 per megapixel._

| Param | Type | Default | Range | Description |
|---|---|---|---|---|
| `brightness` | number | `0` | -100 … 100 | -100 (darker) … 100 (lighter). |
| `contrast` | number | `0` | -100 … 100 | -100 (flat) … 100 (punchy). |

```json
{"type":"brightnessContrast","brightness":10,"contrast":15}
```

#### `exposure` — Exposure

Photographic exposure in stops (linear light), with offset and gamma. _Cost: 1 per megapixel._

| Param | Type | Default | Range | Description |
|---|---|---|---|---|
| `exposure` | number | `0` | -5 … 5 | Stops: +1 doubles the light. |
| `offset` | number | `0` | -0.5 … 0.5 | Lifts (+) or crushes (−) the blacks. |
| `gamma` | number | `1` | 0.1 … 5 | Midtone gamma (1 = unchanged). |

```json
{"type":"exposure","exposure":0.5}
```

#### `shadowsHighlights` — Shadows / Highlights

Open up dark areas and recover bright ones, using local luminance (backlit portraits, skies). _Cost: 4 per megapixel._

| Param | Type | Default | Range | Description |
|---|---|---|---|---|
| `shadows` | number | `35` | 0 … 100 | How much to lighten the shadows. |
| `highlights` | number | `0` | 0 … 100 | How much to darken the highlights. |
| `radius` | number (px) | `30` | 1 … 200 | Neighbourhood size, px. |

```json
{"type":"shadowsHighlights","shadows":40,"highlights":20}
```

### Tone

#### `levels` — Levels

Input black / white points and midtone gamma, output range. _Cost: 1 per megapixel._

| Param | Type | Default | Range | Description |
|---|---|---|---|---|
| `black` | number | `0` | 0 … 254 | Input black point. |
| `white` | number | `255` | 1 … 255 | Input white point. |
| `gamma` | number | `1` | 0.1 … 9.99 | Midtones (>1 lighter). |
| `outBlack` | number | `0` | 0 … 255 | Output black. |
| `outWhite` | number | `255` | 0 … 255 | Output white. |

```json
{"type":"levels","black":12,"white":240,"gamma":1.1}
```

#### `curves` — Curves

Tone curves through control points [input, output] (0..255), smooth (monotone cubic). `rgb` affects all channels; `red` / `green` / `blue` affect one. _Cost: 1 per megapixel._

| Param | Type | Default | Range | Description |
|---|---|---|---|---|
| `rgb` | curve | `[[0,0],[255,255]]` |  | Master curve points, e.g. [[0,0],[64,50],[192,210],[255,255]] (an S-curve). |
| `red` | curve |  |  | Red channel curve (optional). |
| `green` | curve |  |  | Green channel curve (optional). |
| `blue` | curve |  |  | Blue channel curve (optional). |

```json
{"type":"curves","rgb":[[0,0],[64,52],[192,206],[255,255]]}
```

### Color

#### `hueSaturation` — Hue / Saturation

Rotate hues, change saturation and lightness. `colorize` tints the whole image with one hue. _Cost: 2 per megapixel._

| Param | Type | Default | Range | Description |
|---|---|---|---|---|
| `hue` | number | `0` | -180 … 180 | Hue rotation, degrees. |
| `saturation` | number | `0` | -100 … 100 | -100 (grey) … 100. |
| `lightness` | number | `0` | -100 … 100 | -100 … 100. |
| `colorize` | boolean | `false` |  | Tint everything with `hue` (0..360 then) at `saturation`. |

```json
{"type":"hueSaturation","saturation":20}
```

#### `vibrance` — Vibrance

Boost muted colours more than saturated ones (skin-safe saturation). _Cost: 1 per megapixel._

| Param | Type | Default | Range | Description |
|---|---|---|---|---|
| `vibrance` | number | `30` | -100 … 100 | -100 … 100. |
| `saturation` | number | `0` | -100 … 100 | Plain saturation on top, -100 … 100. |

```json
{"type":"vibrance","vibrance":30}
```

#### `temperature` — White balance

Colour temperature (blue ↔ yellow) and tint (green ↔ magenta). Fixes colour casts. _Cost: 1 per megapixel._

| Param | Type | Default | Range | Description |
|---|---|---|---|---|
| `temperature` | number | `0` | -100 … 100 | -100 (cooler) … 100 (warmer). |
| `tint` | number | `0` | -100 … 100 | -100 (green) … 100 (magenta). |

```json
{"type":"temperature","temperature":15}
```

#### `colorBalance` — Color balance

Shift shadows, midtones and highlights towards cyan/red, magenta/green, yellow/blue: [r, g, b] each -100..100. _Cost: 1 per megapixel._

| Param | Type | Default | Range | Description |
|---|---|---|---|---|
| `shadows` | rgb | `[0,0,0]` | -100 … 100 | [cyan↔red, magenta↔green, yellow↔blue] for the shadows. |
| `midtones` | rgb | `[0,0,0]` | -100 … 100 | Same for the midtones. |
| `highlights` | rgb | `[0,0,0]` | -100 … 100 | Same for the highlights. |
| `preserveLuminosity` | boolean | `true` |  | Keep the brightness unchanged. |

```json
{"type":"colorBalance","shadows":[-10,0,10],"highlights":[10,0,-10]}
```

#### `photoFilter` — Photo filter

Warming / cooling / coloured lens filter. _Cost: 1 per megapixel._

| Param | Type | Default | Range | Description |
|---|---|---|---|---|
| `color` | color | `#ec8a00` |  | Filter colour (warming #ec8a00, cooling #006dff…). |
| `density` | number | `25` | 0 … 100 | Strength, 0 … 100. |
| `preserveLuminosity` | boolean | `true` |  | Keep the brightness unchanged. |

```json
{"type":"photoFilter","color":"#ec8a00","density":25}
```

#### `gradientMap` — Gradient map

Map luminance to a gradient (duotones, tritones): shadows take the first stop, highlights the last. _Cost: 1 per megapixel._

| Param | Type | Default | Range | Description |
|---|---|---|---|---|
| `stops` | stops | `["#000000","#ffffff"]` |  | Colours dark → light: ["#1b1340", "#ff7a59"] or [[0,"#000"],[1,"#fff"]]. |

```json
{"type":"gradientMap","stops":["#1b1340","#ff7a59","#fff3d6"]}
```

#### `grayscale` — Black & white

Convert to grey with adjustable channel weights (red / green / blue contributions, %). _Cost: 1 per megapixel._

| Param | Type | Default | Range | Description |
|---|---|---|---|---|
| `red` | number | `30` | -200 … 300 | Red contribution. |
| `green` | number | `59` | -200 … 300 | Green contribution. |
| `blue` | number | `11` | -200 … 300 | Blue contribution. |

```json
{"type":"grayscale"}
```

#### `sepia` — Sepia

Brown monochrome tone. _Cost: 1 per megapixel._

| Param | Type | Default | Range | Description |
|---|---|---|---|---|
| `intensity` | number | `100` | 0 … 100 | 0 … 100. |

```json
{"type":"sepia","intensity":80}
```

#### `invert` — Invert

Negative image. _Cost: 1 per megapixel._

_No parameters._

```json
{"type":"invert"}
```

### Detail

#### `sharpen` — Sharpen

Unsharp mask: amount %, radius px, threshold (skip low-contrast detail such as skin / noise). _Cost: 3 per megapixel._

| Param | Type | Default | Range | Description |
|---|---|---|---|---|
| `amount` | number | `80` | 0 … 500 | Strength, %. |
| `radius` | number (px) | `1.2` | 0.3 … 20 | Px. |
| `threshold` | number | `2` | 0 … 255 | 0 … 255. |

Here `amount` is the filter's own strength (not the 0 … 1 mix of the common params).

```json
{"type":"sharpen","amount":80,"radius":1.2}
```

#### `clarity` — Clarity

Local midtone contrast (texture, punch) — negative values soften. _Cost: 4 per megapixel._

| Param | Type | Default | Range | Description |
|---|---|---|---|---|
| `amount` | number | `30` | -100 … 100 | -100 … 100. |
| `radius` | number (px) | `24` | 2 … 200 | Px. |

Here `amount` is the filter's own strength (not the 0 … 1 mix of the common params).

```json
{"type":"clarity","amount":25}
```

### Blur

#### `blur` — Gaussian blur

Soft blur (backgrounds, depth of field when masked, privacy). _Cost: 3 per megapixel._

| Param | Type | Default | Range | Description |
|---|---|---|---|---|
| `radius` | number (px) | `6` | 0 … 250 | Radius, px. |

```json
{"type":"blur","radius":12}
```

#### `motionBlur` — Motion blur

Directional blur (speed, panning). _Cost: 6 per megapixel._

| Param | Type | Default | Range | Description |
|---|---|---|---|---|
| `angle` | number | `0` | -180 … 180 | Direction, degrees. |
| `distance` | number (px) | `20` | 0 … 400 | Length, px. |

```json
{"type":"motionBlur","angle":0,"distance":30}
```

#### `surfaceBlur` — Surface blur

Edge-preserving smoothing (skin retouch, noise): flattens texture while keeping edges sharp. Usually masked to the area to smooth. _Cost: 6 per megapixel._

| Param | Type | Default | Range | Description |
|---|---|---|---|---|
| `radius` | number (px) | `8` | 1 … 60 | Neighbourhood, px. |
| `threshold` | number | `25` | 1 … 100 | Edge sensitivity, 1 (only flat areas) … 100 (smooth everything). |

```json
{"type":"surfaceBlur","radius":8,"threshold":25}
```

### Stylize

#### `threshold` — Threshold

Pure black & white at a luminance level. _Cost: 1 per megapixel._

| Param | Type | Default | Range | Description |
|---|---|---|---|---|
| `level` | number | `128` | 0 … 255 | 0 … 255. |

```json
{"type":"threshold","level":128}
```

#### `posterize` — Posterize

Reduce the number of tones per channel. _Cost: 1 per megapixel._

| Param | Type | Default | Range | Description |
|---|---|---|---|---|
| `levels` | int | `6` | 2 … 32 | Tones per channel. |

```json
{"type":"posterize","levels":5}
```

#### `noise` — Grain / noise

Film grain (deterministic: same seed, same grain). _Cost: 1 per megapixel._

| Param | Type | Default | Range | Description |
|---|---|---|---|---|
| `amount` | number | `12` | 0 … 100 | 0 … 100. |
| `monochrome` | boolean | `true` |  | Grey grain instead of colour. |
| `seed` | int | `1` | 0 … 999999 | Random seed. |
| `size` | number (px) | `1` | 1 … 8 | Grain size, px. |

Here `amount` is the filter's own strength (not the 0 … 1 mix of the common params).

```json
{"type":"noise","amount":10}
```

#### `pixelate` — Pixelate

Big square pixels (mosaic, anonymise a face when masked). _Cost: 1 per megapixel._

| Param | Type | Default | Range | Description |
|---|---|---|---|---|
| `size` | number (px) | `16` | 2 … 400 | Cell size, px. |

```json
{"type":"pixelate","size":20}
```

#### `vignette` — Vignette

Darken (or lighten, negative amount) the edges to draw the eye to the centre. _Cost: 1 per megapixel._

| Param | Type | Default | Range | Description |
|---|---|---|---|---|
| `amount` | number | `40` | -100 … 100 | -100 (white) … 100 (dark). |
| `size` | number | `50` | 0 … 100 | Clear centre size, 0 … 100. |
| `feather` | number | `60` | 0 … 100 | Softness, 0 … 100. |
| `color` | color | `#000000` |  | Edge colour. |

Here `amount` is the filter's own strength (not the 0 … 1 mix of the common params).

```json
{"type":"vignette","amount":40}
```

### Auto

#### `autoTone` — Auto tone

Stretch each channel's range (clips 0.5 % at each end) — fixes dull / hazy photos and colour casts. _Cost: 1 per megapixel._

| Param | Type | Default | Range | Description |
|---|---|---|---|---|
| `clip` | number | `0.5` | 0 … 5 | Percent clipped at each end. |

```json
{"type":"autoTone"}
```

#### `autoContrast` — Auto contrast

Stretch the luminance range without changing colours. _Cost: 1 per megapixel._

| Param | Type | Default | Range | Description |
|---|---|---|---|---|
| `clip` | number | `0.5` | 0 … 5 | Percent clipped at each end. |

```json
{"type":"autoContrast"}
```

#### `autoColor` — Auto color

Neutralise the colour cast (grey-world white balance) and stretch contrast. _Cost: 1 per megapixel._

_No parameters._

```json
{"type":"autoColor"}
```

### Looks

#### `look` — Look

One-click photo grade (Instagram-style preset). Use `amount` (0..1) to dial it in. _Cost: 2 per megapixel._

| Param | Type | Default | Range | Description |
|---|---|---|---|---|
| `look` | enum (20 values, see below) | `vintage` |  | Look id. |

```json
{"type":"look","look":"cinema","amount":0.7}
```

## Looks

One-click grades: `{ "type": "look", "look": "<id>", "amount"?: 0 … 1 }`.

| Look | Title | Description |
|---|---|---|
| `bw` | B&W | Neutral black & white. |
| `noir` | Noir | Contrasty black & white with a dark vignette. |
| `sepia` | Sepia | Warm brown monochrome, old print. |
| `vintage` | Vintage | Faded warm colours, soft contrast, light vignette. |
| `polaroid` | Polaroid | Warm, slightly washed instant-film look. |
| `lomo` | Lomo | Saturated, contrasty, strong vignette. |
| `warm` | Warm | Golden warm cast. |
| `cool` | Cool | Blue cool cast. |
| `sunset` | Sunset | Orange-pink evening glow. |
| `fade` | Fade | Lifted blacks, matte pastel finish. |
| `punch` | Punch | Vivid colours and extra contrast. |
| `cinema` | Cinema | Teal shadows, orange highlights (blockbuster grade). |
| `cyberpunk` | Cyberpunk | Magenta / cyan neon grade. |
| `cross-process` | Cross process | Green shadows, warm highlights (XPro film). |
| `dramatic` | Dramatic | Desaturated, hard contrast, dark edges. |
| `dreamy` | Dreamy | Soft, airy, pastel lift. |
| `matte` | Matte | Flat matte finish with lifted shadows and gentle colours. |
| `golden-hour` | Golden hour | Late-afternoon warmth with soft highlights. |
| `film` | Film | Subtle film emulation: soft contrast, warm mids, fine grain. |
| `clean` | Clean | Bright, crisp, slightly cool — product / e-commerce. |

## Layer effects

Layer `effects: { "<id>": { …params } }` (`null` removes one). Drawn from the layer's shape after filters and mask.

### `dropShadow` — Drop shadow

Shadow cast by the layer's shape (cut-outs, text, stickers).

| Param | Type | Default | Range | Description |
|---|---|---|---|---|
| `color` | color | `#000000` |  | Shadow colour. |
| `opacity` | number | `0.5` | 0 … 1 | 0 … 1. |
| `angle` | number | `135` | -180 … 180 | Light angle, degrees (135 = shadow down-right). |
| `distance` | number (px) | `12` | 0 … 500 | Offset, px. |
| `blur` | number (px) | `16` | 0 … 250 | Softness, px. |
| `spread` | number (px) | `0` | 0 … 100 | Grow before blurring, px. |

### `outerGlow` — Outer glow

Soft halo around the layer (neon, separation from the background).

| Param | Type | Default | Range | Description |
|---|---|---|---|---|
| `color` | color | `#ffffff` |  | Glow colour. |
| `opacity` | number | `0.6` | 0 … 1 | 0 … 1. |
| `blur` | number (px) | `20` | 0 … 250 | Size, px. |
| `spread` | number (px) | `0` | 0 … 100 | Grow before blurring, px. |

### `innerShadow` — Inner shadow

Shadow inside the layer's edges (inset, pressed look).

| Param | Type | Default | Range | Description |
|---|---|---|---|---|
| `color` | color | `#000000` |  | Shadow colour. |
| `opacity` | number | `0.5` | 0 … 1 | 0 … 1. |
| `angle` | number | `135` | -180 … 180 | Light angle, degrees. |
| `distance` | number (px) | `6` | 0 … 200 | Offset, px. |
| `blur` | number (px) | `10` | 0 … 200 | Softness, px. |

### `stroke` — Stroke

Outline around the layer's shape (sticker outline, text outline).

| Param | Type | Default | Range | Description |
|---|---|---|---|---|
| `color` | color | `#ffffff` |  | Outline colour. |
| `width` | number (px) | `6` | 0 … 200 | Px. |
| `position` | `outside` \\| `center` \\| `inside` | `outside` |  | Where the outline sits. |
| `opacity` | number | `1` | 0 … 1 | 0 … 1. |

### `colorOverlay` — Color overlay

Fill the layer's shape with a colour (recolour icons / silhouettes).

| Param | Type | Default | Range | Description |
|---|---|---|---|---|
| `color` | color | `#ffffff` |  | Colour. |
| `opacity` | number | `1` | 0 … 1 | 0 … 1. |
| `blend` | enum (16 values, see below) | `normal` |  | Blend mode of the overlay. |

## Shapes

Shape layer `shape`: `rect`, `ellipse`, `line`, `polygon`, `star`. Masks accept `rect` and `ellipse`.

## Fonts

Bundled (OFL, `library/fonts`): text layer `font: "<id>"`. Other names render with the computer's fonts.

| Font | Family | Style | Weights | Description |
|---|---|---|---|---|
| `inter` | Inter | sans | 400, 600, 700, 800 | Neutral modern sans — UI, body text, clean headlines. |
| `montserrat` | Montserrat | sans | 400, 700, 800 | Geometric sans — bold marketing headlines. |
| `poppins` | Poppins | sans | 400, 600, 700 | Friendly geometric sans — social posts, thumbnails. |
| `space-grotesk` | Space Grotesk | sans | 500, 700 | Techy grotesk — startups, tech. |
| `playfair` | Playfair Display | serif | 400, 700 (italic 400) | Elegant high-contrast serif — luxury, editorial, quotes. |
| `dm-serif` | DM Serif Display | serif | 400 | Display serif — magazine covers, titles. |
| `roboto-slab` | Roboto Slab | slab | 400, 700 | Sturdy slab serif — posters, labels. |
| `bebas-neue` | Bebas Neue | display | 400 | Tall all-caps condensed — YouTube thumbnails, posters, sports. |
| `anton` | Anton | display | 400 | Heavy condensed — impact headlines. |
| `oswald` | Oswald | display | 400, 600 | Condensed gothic — banners, sale tags. |
| `archivo-black` | Archivo Black | display | 400 | Very bold grotesk — loud short words. |
| `lobster` | Lobster | script | 400 | Retro bold script — food, vintage, fun. |
| `pacifico` | Pacifico | script | 400 | Surf brush script — casual, summer. |
| `caveat` | Caveat | script | 400, 700 | Handwriting — notes, annotations, personal touch. |
| `jetbrains-mono` | JetBrains Mono | mono | 400, 700 | Monospace — code, tech labels. |

## Size presets

`agentphoto new --size <id>`, `project_create { size }`, `export { preset }`.

| Preset | Title | Size | Description |
|---|---|---|---|
| `og` | Open Graph / link preview | 1200 × 630 | Facebook, LinkedIn, Slack, iMessage link cards. |
| `square` | Square post | 1080 × 1080 | Instagram / Facebook feed. |
| `portrait` | Portrait post | 1080 × 1350 | Instagram 4:5 feed. |
| `story` | Story / Reel / TikTok | 1080 × 1920 | 9:16 vertical. |
| `landscape` | Full HD | 1920 × 1080 | 16:9 slides, hero images, wallpapers. |
| `youtube` | YouTube thumbnail | 1280 × 720 | 16:9 video thumbnail. |
| `twitter` | X / Twitter post | 1600 × 900 | 16:9 in-feed image. |
| `pinterest` | Pinterest pin | 1000 × 1500 | 2:3 pin. |
| `banner` | Web banner | 1920 × 600 | Wide hero / header banner. |
| `linkedin-banner` | LinkedIn banner | 1584 × 396 | Profile cover. |
| `avatar` | Avatar | 800 × 800 | Profile picture (often shown round). |
| `product` | Product shot | 2000 × 2000 | E-commerce square on white. |
| `a4` | A4 portrait (150 dpi) | 1240 × 1754 | Flyer / print at 150 dpi. |

## AI models

Run locally (transformers.js); downloaded once from Hugging Face into `~/.cache/agentphoto/models` (`AGENTPHOTO_MODELS` overrides).

| Model | Task | Repository | Size | Licence | Description |
|---|---|---|---|---|---|
| `rmbg-1.4` (default) | background-removal | briaai/RMBG-1.4 | 168 MB | bria-rmbg-1.4 (non-commercial) | General background removal — products, people, animals, objects. Best default. |
| `modnet` | background-removal | Xenova/modnet | 25 MB | Apache-2.0 | Portrait matting — people only, soft hair edges. |
| `slimsam` (default) | segmentation | Xenova/slimsam-77-uniform | 30 MB | Apache-2.0 | Segment Anything (light): select an object from points or a box. |
| `sam-base` | segmentation | Xenova/sam-vit-base | 100 MB | Apache-2.0 | Segment Anything (base): more precise selections, slower. |
