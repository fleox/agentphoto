# Layouts per format

Coordinates are canvas pixels (origin top-left). Each grid below is what the matching template uses; start from the template (`templates show <id>`) when one fits, and adapt sizes to the text length (check the render).

## YouTube thumbnail — 1280×720 (`youtube-thumbnail`)

- Subject cut out on the right half (`x` 700, box 560×660), white `stroke` 10 + `dropShadow` so it pops off the background.
- Title on the left: `bebas-neue` 130..160 px, `lineHeight` 0.95, 2 lines max, `width` ≈ 680, dark `stroke` 8.
- One label pill (`montserrat` 800, 40..48 px, `background` with `padding: [18, 10]`, `radius` 8, slight `rotation` -3).
- Background: a saturated 2..3 stop gradient; a soft radial glow behind the head.
- Keep the bottom-right 200×60 free (video duration).

## Link preview / Open Graph — 1200×630 (`og-article`)

- Text panel on the left 55 %, photo on the right fading in with a gradient mask `{"gradient":{"type":"linear","angle":0,"stops":["black","white"]}}`.
- Kicker (small caps, `letterSpacing` 3..4, accent colour) above a 56..72 px title, 3 lines max, `width` ≤ 600.
- Site name at the bottom-left, 22..26 px. Platforms crop the edges slightly: keep 48 px margins.

## Square post — 1080×1080 (`social-quote`)

- Full-bleed photo (`fit: "cover"`), darkened with a fill layer or `brightnessContrast`, a little `blur` for a quote background.
- Centred or left-aligned text block within an 880 px column; quote 64..80 px `playfair`, author 30..34 px.

## Story / Reel — 1080×1920 (`story-promo`)

- Full-bleed photo, dark gradient fill on the bottom 45 % for the text.
- Title 120..160 px between y ≈ 1200 and 1550; a call-to-action pill (`background` radius = half its height) under it.
- Nothing important above y 250 or below y 1620 (app UI).

## Web banner — 1920×600 (`sale-banner`); LinkedIn banner — 1584×396

- Text on the left third, photo on the right fading in, a starburst badge (`shape: "star"`, `sides` 12..16, `innerRadius` 0.8) for a discount.
- LinkedIn: the profile picture covers the bottom-left (≈ 0..400 × 200..396 on desktop): keep text on the right two thirds.

## Product card — 2000×2000 (`product-white`)

- Cut-out product centred, filling 65..75 % of the width, contact shadow ellipse under it (`rgba(0,0,0,0.28)`, `blur` filter), soft off-white backdrop.

## Colour pairs that read well

| Background | Text | Accent |
|---|---|---|
| `#0f172a` (slate) | `#f8fafc` | `#38bdf8` |
| `#12082e` → `#ff4f81` (gradient) | `#ffffff` with `#12082e` stroke | `#ffd166` |
| `#fff7ed` (cream) | `#1c1917` | `#ea580c` |
| `#052e16` (forest) | `#ecfdf5` | `#a3e635` |
| `#111111` | `#ffffff` | brand colour |

## Badges and pills

```json
{ "id": "pill", "type": "text", "text": "Shop now", "x": 64, "y": 470, "font": "poppins", "weight": 700, "size": 34, "color": "#ffffff",
  "background": { "color": "#111827", "padding": [28, 14], "radius": 40 } }
```

```json
{ "id": "badge", "type": "shape", "shape": "star", "x": 1580, "y": 60, "width": 240, "height": 240, "sides": 14, "innerRadius": 0.82, "fill": "#3b0a14", "rotation": 12 }
```

Add them with `layer add --layer '<json>'`, then a text layer centred on the badge (`width` = the badge width, `align: "center"`).
