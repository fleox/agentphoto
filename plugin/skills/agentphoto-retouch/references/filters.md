# Filters cheat-sheet

The catalog is the source of truth: `npx -y @fleox/agentphoto@0.1.1 catalog filters --json` lists every filter with its parameters (type, range, default) and an example; `npx -y @fleox/agentphoto@0.1.1 catalog filters shadowsHighlights --json` shows one. Unknown ids or parameters fail validation with a "did you mean" hint.

A filter is `{ "type": "<id>", ...params }` plus two common parameters: `amount` (0..1, blend with the unfiltered pixels, default 1) and `enabled` (false = kept but skipped). On an image / text / shape layer it changes that layer; on an **adjustment layer** it changes everything below it (inside its group).

## Light and tone

| Filter | Key parameters | Typical use |
|---|---|---|
| `exposure` | `exposure` -5..5 stops, `offset` -0.5..0.5, `gamma` 0.1..5 | Under / over-exposed photo: +0.2..+0.6 |
| `brightnessContrast` | `brightness`, `contrast` -100..100 | Quick global tweak |
| `shadowsHighlights` | `shadows` 0..100, `highlights` 0..100, `radius` 1..200 | Backlit faces, bright skies: 25..40 / 15..30 |
| `levels` | `black` 0..254, `white` 1..255, `gamma`, `outBlack`, `outWhite` | Flat / hazy photo: black / white near `analyze` `range` |
| `curves` | `rgb`, `red`, `green`, `blue`: `[[in, out], …]` 0..255, inputs increasing | S-curve `[[0,0],[64,54],[192,204],[255,255]]`, faded blacks `[[0,20],[255,255]]` |
| `autoTone`, `autoContrast` | `clip` 0..5 % | One-click starting point; check the render |
| `autoColor` | none | Neutralise a strong cast |

## Colour

| Filter | Key parameters | Typical use |
|---|---|---|
| `temperature` | `temperature` -100..100 (negative = cooler), `tint` -100..100 (negative = greener) | Colour casts: start at ±8..15 |
| `vibrance` | `vibrance` -100..100, `saturation` | Dull colours, skin-safe: 15..30 |
| `hueSaturation` | `hue` -180..180, `saturation`, `lightness` -100..100, `colorize` | Strong saturation change, tinting with `colorize: true` |
| `colorBalance` | `shadows`, `midtones`, `highlights`: `[r, g, b]` each -100..100 | Teal shadows / warm highlights: `"shadows":[-10,0,10],"highlights":[10,0,-10]` |
| `photoFilter` | `color`, `density` 0..100 | Warming / cooling lens filter |
| `gradientMap` | `stops`: colours or `[offset, colour]` | Duotones: `["#1b1340","#ff7a59","#fff3d6"]` |
| `grayscale` | `red`, `green`, `blue` weights (%) | Black and white with control over which colours go light |
| `sepia` | `intensity` 0..100 | Brown monochrome |
| `invert` | none | Negative |

## Detail and blur

| Filter | Key parameters | Typical use |
|---|---|---|
| `sharpen` | `amount` 0..500 %, `radius` 0.3..20, `threshold` 0..255 | Web output: 50..80, radius 1, threshold 3..6 (spares skin) |
| `clarity` | `amount` -100..100, `radius` 2..200 | Texture and punch: 10..25; negative softens |
| `surfaceBlur` | `radius` 1..60, `threshold` 1..100 | Skin smoothing on a masked copy: 8..12 / 15..25, `amount` 0.6..0.8 |
| `blur` | `radius` 0..250 | Background blur on a masked copy, privacy |
| `motionBlur` | `angle`, `distance` 0..400 | Speed effect |
| `noise` | `amount` 0..100, `monochrome`, `size` 1..8, `seed` | Film grain: 5..10 |
| `vignette` | `amount` -100..100 (negative = white), `size`, `feather`, `color` | Focus on the centre: 20..40 |

## Stylize

`threshold` (`level`), `posterize` (`levels` 2..32), `pixelate` (`size`), and `look` (`look`: `bw`, `noir`, `sepia`, `vintage`, `polaroid`, `lomo`, `warm`, `cool`, `sunset`, `fade`, `punch`, `cinema`, `cyberpunk`, `cross-process`, `dramatic`, `dreamy`, `matte`, `golden-hour`, `film`, `clean`). Use a look at `amount` 0.5..0.8 on the adjustment layer, after the corrections.

## Order matters

Filters run in list order. A good order on an adjustment layer: tone (levels / curves / exposure) → colour (temperature / vibrance) → look → vignette / grain. Detail filters (`sharpen`, `clarity` on the photo) and smoothing (`surfaceBlur` on a skin copy) belong on the image layers.
