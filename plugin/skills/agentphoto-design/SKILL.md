---
name: agentphoto-design
description: Design social media and marketing visuals with AgentPhoto - YouTube thumbnails, Open Graph / link previews, Instagram posts and stories, Pinterest pins, web and LinkedIn banners, sale ads, quote posts, avatars and product cards - from templates or a blank canvas at the right size preset, with the user's photo, bundled fonts, text with effects, shapes, gradients and cut-out subjects, following layout rules (safe margins, contrast, hierarchy), checked on headless renders and exported in several formats at once. Use when the user wants a thumbnail, banner, post, story, cover, ad, flyer, card or any visual combining a photo with text.
license: PolyForm-Noncommercial-1.0.0
compatibility: Requires Node.js 22+ and Google Chrome (or Chromium/Edge/Brave) for renders.
metadata:
  version: "0.1.0"
  repository: "https://github.com/fleox/agentphoto"
allowed-tools: Bash Read Write
---

# Design visuals with AgentPhoto

**Language:** talk to the user in their language; keep commands, ids and files in English. Text that appears **in the image** is in the language the user wants on the visual.

Every command is `npx -y @fleox/agentphoto@0.1.0 <command> --json` with `--project <dir>`. Read `error.hint` when `ok` is false. Basics (filters, render, patches): skill `agentphoto-retouch`; cut-outs: skill `agentphoto-cutout`.

## 1. Brief

Get, or decide and say: the **format** (where it will be posted), the **message** (a title of 2 to 6 words, optional subtitle / call to action), the **photo** (the user's file, or a built-in sample) and the **brand** (colours, font mood). Do not ask more than two questions; propose defaults.

## 2. Start from a template (fastest)

```bash
npx -y @fleox/agentphoto@0.1.0 templates list --json
npx -y @fleox/agentphoto@0.1.0 templates show youtube-thumbnail --json
npx -y @fleox/agentphoto@0.1.0 new thumb --template youtube-thumbnail --image ./photo.jpg --json
npx -y @fleox/agentphoto@0.1.0 render --project thumb --json
```

The photo goes into the template's **slot** layer (`slot` in `templates list`, usually `photo`), keeping its box, fit, filters and effects. Templates: `youtube-thumbnail` (1280×720), `og-article` (1200×630), `social-quote` (1080×1080), `story-promo` (1080×1920), `sale-banner` (1920×600), `polaroid` (1080×1350), `avatar-pro` (800×800), `product-white` (2000×2000). `templates list --category social` or `--query sale` filters them.

Then make it the user's:

```bash
npx -y @fleox/agentphoto@0.1.0 doc summary --project thumb --json
npx -y @fleox/agentphoto@0.1.0 layer update title --set 'text="3 tricks\nnobody uses"' --project thumb --json
npx -y @fleox/agentphoto@0.1.0 layer update kicker --set text="TESTED" --set background.color=#00e0a4 --project thumb --json
npx -y @fleox/agentphoto@0.1.0 doc patch --project thumb --json '[{"op":"set","path":"canvas.background","value":{"type":"linear","angle":20,"stops":["#04131f","#0b5d7a","#00e0a4"]}}]'
```

Templates described as "cut-out" (`youtube-thumbnail`, `avatar-pro`, `product-white`) look right only once the subject is cut out: run `remove-bg photo` (skill `agentphoto-cutout`), then render.

## 3. Or start from a size preset

```bash
npx -y @fleox/agentphoto@0.1.0 catalog sizes --json
npx -y @fleox/agentphoto@0.1.0 new launch --size og --background "#0f172a" --json
npx -y @fleox/agentphoto@0.1.0 assets add ./photo.jpg --license proprietary --add-layer --layer-id photo --project launch --json
npx -y @fleox/agentphoto@0.1.0 layer update photo --set x=600 --set y=0 --set width=600 --set height=630 --set fit=cover --project launch --json
npx -y @fleox/agentphoto@0.1.0 mask set photo --mask '{"gradient":{"type":"linear","angle":0,"stops":["black","white"]}}' --project launch --json
npx -y @fleox/agentphoto@0.1.0 layer add --id title --text "Find your quiet place" --set x=64 --set y=200 --set width=500 --set font=playfair --set size=72 --set weight=700 --set lineHeight=1.05 --set color=#f8fafc --project launch --json
npx -y @fleox/agentphoto@0.1.0 layer add --id kicker --text "NEW GUIDE" --set x=64 --set y=150 --set font=inter --set weight=700 --set size=22 --set letterSpacing=4 --set color=#38bdf8 --project launch --json
npx -y @fleox/agentphoto@0.1.0 layer add --layer '{"id":"rule","type":"shape","shape":"rect","x":64,"y":420,"width":80,"height":6,"radius":3,"fill":"#38bdf8"}' --project launch --json
npx -y @fleox/agentphoto@0.1.0 render --project launch --json
```

Presets: `og` 1200×630, `square` 1080×1080, `portrait` 1080×1350, `story` 1080×1920, `landscape` 1920×1080, `youtube` 1280×720, `twitter` 1600×900, `pinterest` 1000×1500, `banner` 1920×600, `linkedin-banner` 1584×396, `avatar` 800×800, `product` 2000×2000, `a4` 1240×1754. `fit: "cover"` + `focus: [x, y]` (0..1) frames a photo in any box without distortion.

## 4. Typography

15 bundled fonts (no web fonts, identical on every computer): `npx -y @fleox/agentphoto@0.1.0 catalog fonts --json` lists them with weights.

| Mood | Title font | Body / small text |
|---|---|---|
| YouTube, sport, impact | `bebas-neue`, `anton`, `archivo-black` | `montserrat` 800, `poppins` 700 |
| Clean tech / SaaS | `inter` 800, `space-grotesk` 700 | `inter` 400..600 |
| Editorial, luxury, quotes | `playfair` 700, `dm-serif` | `inter`, `montserrat` |
| Friendly, food, kids | `poppins` 700, `lobster`, `pacifico` | `poppins` 400 |
| Handwritten caption | `caveat` 700 | — |
| Poster, label | `roboto-slab` 700, `oswald` 600 | `oswald` 400 |

Text fields: `size` (px), `weight` (only the weights the font has), `width` (wraps, needed for multi-line), `align`, `lineHeight` (0.95..1.1 for big titles), `letterSpacing` (2..6 for small caps labels), `transform: "uppercase"`, `color` (colour or gradient), `background` `{ "color", "padding": [h, v], "radius" }` for a label / pill. Use `\n` in `text` for chosen line breaks: in `--set`, write the value as a JSON string so `\n` becomes a line break (`--set 'text="Line one\nline two"'`); unquoted, it stays a literal backslash-n.

Effects that keep text readable on photos: `stroke` (`{ "color": "#12082e", "width": 8 }` on thumbnails), `dropShadow` (`{ "opacity": 0.4, "blur": 18 }`), or a gradient fill layer / shape behind the text.

## 5. Layout rules

- **Safe margins**: keep text and faces at least 5 % of the canvas from every edge (64 px on 1280 wide). Stories: keep the top 250 px and bottom 300 px of 1920 free of important text (app UI covers them). YouTube: the bottom-right corner holds the video duration.
- **Hierarchy**: one dominant title (big, heavy), one secondary line at most a third of its size, one accent colour. Max 3 text layers on a thumbnail, 6 words in the title.
- **Contrast**: light text on dark areas or the reverse; on a busy photo add a gradient fill layer (`rgba(0,0,0,0)` → `rgba(0,0,0,0.6)`) or a stroke. Check on the render that every letter is readable.
- **Faces and subjects** on the opposite side from the text, looking towards it when possible; never crop through eyes or chins.
- **Thumbnail test**: the visual must still read at small size. Render a small preview and look:
  ```bash
  npx -y @fleox/agentphoto@0.1.0 render --project thumb --max-width 320 --json
  ```
- **Brand colours**: reuse the user's hex values exactly; derive dark / light tints for backgrounds rather than adding new hues.

More layouts (composition grids per format, colour pairs, badge and pill recipes): [references/layouts.md](references/layouts.md).

## 6. Check and deliver

```bash
npx -y @fleox/agentphoto@0.1.0 check --project thumb --json
npx -y @fleox/agentphoto@0.1.0 export --project thumb --format jpeg --quality 90 --json
```

`check` flags text that may run off the canvas, layers outside it and upscaled (soft) photos. Several sizes from one design (export `--variants`, `fit` cover / contain) and web weights: skill `agentphoto-publish`. For a set of variants (A/B titles, colours), copy the project folder per variant, change it and render each; show the user the renders side by side.

## Rules

- Render after every visual change and look at the whole picture and at the small version.
- Keep ids stable (`title`, `photo`…): patches and the Studio refer to them.
- Licences: the user's photos are theirs; built-in samples are CC0; bundled fonts are OFL / Apache-2.0 and need no credit in images. `check` lists `licences` that need attribution.
